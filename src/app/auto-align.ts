import type { AnalysisResult } from '../alignment/analyze';
import type { Section } from '../alignment/sections';
import { AlignmentMap, type BarSpan } from '../audio/alignment-map';
import type { AlignmentRecord, SectionRecord } from '../audio/recording-profile';

/** What the alignment panel says about the loaded recording. */
export type AlignStatus =
  | { readonly phase: 'idle' }
  /** The recording is loaded and detection is waiting for the tab's sound to finish loading. */
  | { readonly phase: 'waiting' }
  | { readonly phase: 'analysing'; readonly progress: number }
  | { readonly phase: 'found'; readonly sections: number; readonly skipped: number }
  | { readonly phase: 'not-found'; readonly reason: 'too-long' | 'silent' | 'not-confident' | 'out-of-range' }
  | { readonly phase: 'failed'; readonly reason: 'decode' | 'render' | 'worker' | 'no-sound' }
  /** A result arrived after the user had already moved the offset, so it was not applied. */
  | { readonly phase: 'discarded' }
  /** The offset was set by hand, or the user reverted to it. */
  | { readonly phase: 'manual' }
  /** The recording was lined up before bar-level alignment existed; its saved alignment is kept until the user re-analyses. */
  | { readonly phase: 'baseline-missing' };

/**
 * Whether a recording that has just loaded is analysed. Anything the user already decided wins: a saved profile
 * (an alignment is restored, and an offset saved before alignment existed counts as set by hand) and an offset
 * the user has moved since the recording loaded both skip detection. Re-analyse is always available.
 */
export function decideAutoAlign(ctx: { hasProfile: boolean; offsetMoved: boolean }): 'run' | 'skip' {
  return ctx.hasProfile || ctx.offsetMoved ? 'skip' : 'run';
}

export interface Settled {
  /** The alignment to apply, or null when nothing changes. */
  readonly map: AlignmentMap | null;
  readonly status: AlignStatus;
  /** The recording's parts, and how well each bar was matched, to go with an applied alignment; empty otherwise. */
  readonly sections: readonly Section[];
  readonly barConfidence: readonly number[];
  readonly barMatched: readonly boolean[];
}

const nothing = { sections: [], barConfidence: [], barMatched: [] } as const;

/**
 * What to do with a finished analysis. A result for a recording that is no longer loaded, or a cancelled run,
 * is ignored (null); a result is not applied over an offset the user moved while it ran.
 */
export function settleAnalysis(ctx: { stillCurrent: boolean; offsetMoved: boolean }, result: AnalysisResult): Settled | null {
  if (!ctx.stillCurrent || result.kind === 'cancelled') return null;
  switch (result.kind) {
    case 'aligned':
      return ctx.offsetMoved
        ? { map: null, status: { phase: 'discarded' }, ...nothing }
        : {
            map: result.map,
            status: { phase: 'found', sections: result.map.holds.length, skipped: result.skippedStretches },
            sections: result.sections,
            barConfidence: result.barConfidence,
            barMatched: result.barMatched,
          };
    case 'not-found':
      return { map: null, status: { phase: 'not-found', reason: result.reason }, ...nothing };
    case 'failed':
      return { map: null, status: { phase: 'failed', reason: result.reason }, ...nothing };
  }
}

/** What to save for an alignment: the extra playing, and for the bar-level form the anchors and the sections. */
export function recordFromMap(map: AlignmentMap, source: AlignmentRecord['source'], sections: readonly SectionRecord[]): AlignmentRecord {
  const record: AlignmentRecord = { source, holds: map.holds.map((h) => ({ at: h.at, length: h.length })) };
  const anchored = map.anchorData;
  if (anchored) {
    record.anchors = [...anchored.anchors];
    record.endAnchor = anchored.endAnchor;
  }
  if (sections.length > 0) record.sections = sections.map((s) => ({ ...s }));
  return record;
}

/**
 * The alignment a saved record describes for this tab: the bar-level form when its anchors fit the tab's played bars,
 * and otherwise the offset and extra playing it also carries, which is all an older record has.
 */
export function mapFromRecord(offset: number, record: AlignmentRecord | undefined, bars: readonly BarSpan[]): AlignmentMap {
  if (record?.anchors && record.endAnchor !== undefined) {
    const anchored = AlignmentMap.fromAnchors(bars, record.anchors, record.endAnchor);
    if (anchored) return anchored;
  }
  return AlignmentMap.of(offset, record?.holds ?? []);
}

/** True for an analysed record saved before bar-level alignment, which has the offset and extra playing but no anchors. */
export function needsBaseline(record: AlignmentRecord): boolean {
  return record.source === 'auto' && !record.anchors;
}
