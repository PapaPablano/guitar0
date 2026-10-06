import type { AnalysisResult } from '../alignment/analyze';
import type { Section } from '../alignment/sections';
import { checkTimeline, type OutcomeTier } from '../alignment/timeline-check';
import { AlignmentMap, type BarSpan } from '../audio/alignment-map';
import type { AlignmentRecord, RecordingProfile, SectionRecord } from '../audio/recording-profile';
import { tabFingerprint } from '../audio/tab-fingerprint';

/** Which build of the whole-song pass a saved timeline came from. A record without this one is detected again when it opens. */
export const TIMELINE_REVISION = 1;

export type NotFoundReason = 'too-long' | 'silent' | 'not-confident' | 'out-of-range' | 'inconsistent';

/** What the alignment panel says about the loaded recording. */
export type AlignStatus =
  | { readonly phase: 'idle' }
  /** The recording is loaded and detection is waiting for the tab's sound to finish loading. */
  | { readonly phase: 'waiting' }
  /** `again` is true when a saved timing from before is being detected again, and plays until the new one is committed. */
  | { readonly phase: 'analysing'; readonly progress: number; readonly again?: boolean }
  /** A timeline is committed and most bars are supported by onsets or by the whole-song pass. */
  | { readonly phase: 'lined-up'; readonly skipped: number }
  /** A timeline is committed, but the accuracy target is not met for enough bars. */
  | { readonly phase: 'roughly'; readonly skipped: number }
  /** No timeline: the recording plays against the global offset alone. */
  | { readonly phase: 'not-found'; readonly reason: NotFoundReason }
  | { readonly phase: 'failed'; readonly reason: 'decode' | 'render' | 'worker' | 'no-sound' }
  /** A new detection failed the check, so the timeline already in use stays. */
  | { readonly phase: 'kept-previous' };

const nothing = { sections: [], barConfidence: [], barMatched: [] } as const;

export interface Settled {
  /** The timeline to commit, or null when nothing changes. */
  readonly map: AlignmentMap | null;
  readonly status: AlignStatus;
  readonly tier: OutcomeTier | null;
  /** The recording's parts, and how well each bar was matched, to go with a committed timeline; empty otherwise. */
  readonly sections: readonly Section[];
  readonly barConfidence: readonly number[];
  readonly barMatched: readonly boolean[];
  /** True when the failure should be remembered, so opening the recording again does not repeat it. */
  readonly remember: boolean;
}

export interface SettleContext {
  /** False for a result of a run that is no longer the latest, of another recording or tab, or of a cancelled run. */
  readonly stillCurrent: boolean;
  /** The owner moved the offset after the run began, so its result is not applied. */
  readonly offsetMovedSinceStart: boolean;
  /** The tab's played bars, which the result must still fit. */
  readonly bars: readonly BarSpan[];
  /** A timeline is in use already (a re-detection), so a failed check keeps it instead of reporting no timeline. */
  readonly hasTimeline: boolean;
}

const unchanged = (status: AlignStatus): Settled => ({ map: null, status, tier: null, ...nothing, remember: false });

/** Whether the map's anchors fail the whole-song consistency check. */
function failsCheck(map: AlignmentMap, bars: readonly BarSpan[]): boolean {
  const anchored = map.anchorData;
  if (!anchored) return true;
  return checkTimeline(bars, anchored.anchors, anchored.endAnchor).length > 0;
}

/**
 * The one decision about a finished analysis, and the only way a detected timeline becomes the timeline in use. A result
 * for a run that is no longer current is ignored (null). The whole-song result is checked first; on a first open a failed
 * check falls back to the bar-by-bar result if that passes (as roughly lined up), and otherwise the recording is not lined up,
 * while a re-detection that fails keeps the timeline already in use.
 */
export function settleAnalysis(ctx: SettleContext, result: AnalysisResult): Settled | null {
  if (!ctx.stillCurrent || result.kind === 'cancelled') return null;
  switch (result.kind) {
    case 'aligned': {
      if (ctx.offsetMovedSinceStart) return unchanged({ phase: 'idle' });
      const skipped = result.skippedStretches;
      const base = { sections: result.sections, barConfidence: result.barConfidence, barMatched: result.barMatched, remember: false };
      if (!failsCheck(result.map, ctx.bars)) {
        const tier = result.tier;
        return { map: result.map, status: tier === 'lined-up' ? { phase: 'lined-up', skipped } : { phase: 'roughly', skipped }, tier, ...base };
      }
      if (ctx.hasTimeline) return { ...unchanged({ phase: 'kept-previous' }), remember: true };
      if (!failsCheck(result.perBarMap, ctx.bars)) {
        return { map: result.perBarMap, status: { phase: 'roughly', skipped }, tier: 'roughly', ...base };
      }
      return { ...unchanged({ phase: 'not-found', reason: 'inconsistent' }), remember: true };
    }
    case 'not-found':
      return ctx.hasTimeline ? { ...unchanged({ phase: 'kept-previous' }), remember: true } : { ...unchanged({ phase: 'not-found', reason: result.reason }), remember: true };
    case 'failed':
      return unchanged({ phase: 'failed', reason: result.reason });
  }
}

/** What to save for a committed timeline, or for a recording with only an offset. */
export function recordFromMap(
  map: AlignmentMap,
  source: AlignmentRecord['source'],
  sections: readonly SectionRecord[],
  stamp?: { fingerprint: string; tier: OutcomeTier; previousOffset?: number },
): AlignmentRecord {
  const record: AlignmentRecord = { source, holds: map.holds.map((h) => ({ at: h.at, length: h.length })) };
  const anchored = map.anchorData;
  if (anchored) {
    record.anchors = [...anchored.anchors];
    record.endAnchor = anchored.endAnchor;
  }
  if (sections.length > 0) record.sections = sections.map((s) => ({ ...s }));
  if (stamp) {
    record.revision = TIMELINE_REVISION;
    record.fingerprint = stamp.fingerprint;
    record.tier = stamp.tier;
    if (stamp.previousOffset !== undefined) record.previousOffset = stamp.previousOffset;
  }
  return record;
}

/** The saved record with a failed detection noted, so the next open of this recording and tab does not run it again. */
export function withAttempt(record: AlignmentRecord | undefined, fingerprint: string): AlignmentRecord {
  return { ...(record ?? { source: 'manual' as const, holds: [] }), attempt: { revision: TIMELINE_REVISION, fingerprint } };
}

/**
 * The map a saved record describes for this tab: its bar-level anchors when they fit the tab's played bars, and otherwise
 * the offset and extra playing it also carries, which is all an older record has. `fits` says which.
 */
export function restoreFromRecord(offset: number, record: AlignmentRecord | undefined, bars: readonly BarSpan[]): { map: AlignmentMap; fits: boolean } {
  if (record?.anchors && record.endAnchor !== undefined) {
    const anchored = AlignmentMap.fromAnchors(bars, record.anchors, record.endAnchor);
    if (anchored) return { map: anchored, fits: true };
  }
  return { map: AlignmentMap.of(offset, record?.holds ?? []), fits: false };
}

/** What happens when a recording opens, from what is saved for it. */
export type OpenDecision =
  /** A saved timeline is current for this build and tab: use it, with no analysis. */
  | { readonly action: 'reuse'; readonly map: AlignmentMap; readonly tier: OutcomeTier }
  /** Detect (again): `play` is what plays until the new timeline commits. */
  | { readonly action: 'detect'; readonly play: AlignmentMap }
  /** A detection for this build and tab already failed and no timeline exists: stay on the offset and say so. */
  | { readonly action: 'stay'; readonly play: AlignmentMap };

/**
 * Whether a recording that has just loaded is analysed (KD6). A saved timeline of the current revision whose tab
 * fingerprint and anchors fit is reused. A record from before, a stale fingerprint or anchors that do not fit is detected
 * again, and until it commits the older record plays where its anchors still fit and the saved offset alone plays otherwise.
 * A failed attempt for this revision and tab is not repeated until the revision or tab changes or the owner presses Re-analyse.
 */
export function decideOnOpen(profile: RecordingProfile | null, bars: readonly BarSpan[]): OpenDecision {
  const fingerprint = tabFingerprint(bars);
  const record = profile?.alignment;
  const offset = profile?.offset ?? 0;
  const { map, fits } = restoreFromRecord(offset, record, bars);
  const current = record?.revision === TIMELINE_REVISION && record.fingerprint === fingerprint && fits && record.source === 'auto';
  if (current) return { action: 'reuse', map, tier: record.tier ?? 'roughly' };
  const failedAlready = record?.attempt?.revision === TIMELINE_REVISION && record.attempt.fingerprint === fingerprint;
  // A timeline placed on another tab is worse than none, so a remembered failure plays only the saved offset unless the record is for this tab.
  if (failedAlready) return { action: 'stay', play: record?.fingerprint === fingerprint && fits ? map : AlignmentMap.of(offset, []) };
  return { action: 'detect', play: map };
}
