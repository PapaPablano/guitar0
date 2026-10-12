import type { AnalysisResult } from '../alignment/analyze';
import type { BarSpan } from '../audio/alignment-map';
import { clampOffset, OFFSET_MAX_SECONDS } from '../audio/offset-range';
import type { AlignmentRecord, TakeNoMatchReason } from '../audio/recording-profile';
import { tabFingerprint } from '../audio/tab-fingerprint';

/**
 * Judging a YouTube take against the tab (KD1 to KD3): the take is placed by one offset, or it is found not to line up.
 * Everything here is pure, so the decision that carries the product's precision rule is tested without the screen.
 */

/**
 * Which build of this decision a remembered take came from. A record without the current one is judged again, so a change to
 * the analysis or to this decision bumps it and forces a re-check.
 */
export const TAKE_REVISION = 1;

/**
 * How far any one bar's offset may sit from the take's median offset and still count as one offset. Anchors are rounded to
 * 10 ms, so nothing under about 20 ms is workable; 50 ms is the working bar of the bar-level alignment (R2 of its plan).
 * A take whose tempo differs even slightly drifts past this within a song, which is what rejects it (KD3).
 */
export const TAKE_TOLERANCE_SECONDS = 0.05;

export type TakeVerdict =
  | { readonly kind: 'offset'; readonly offset: number }
  | { readonly kind: 'no-match'; readonly reason: TakeNoMatchReason };

/** What a finished analysis means for a take: a verdict, or the check could not run (`failed`), or it was cancelled. */
export type TakeJudged =
  | TakeVerdict
  | { readonly kind: 'failed'; readonly reason: 'decode' | 'render' | 'worker' | 'no-sound' }
  | { readonly kind: 'cancelled' };

const noMatch = (reason: TakeNoMatchReason): TakeVerdict => ({ kind: 'no-match', reason });

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The one offset an aligned result stands for, or the reason it does not. The whole-song result is used, never the bar-by-bar
 * fallback. It counts only when it is the lined-up tier with no holds and no skipped stretches, every bar's offset (its anchor
 * minus the tab bar's start, and the end anchor against the tab's end) is within the tolerance of the median, and the median
 * is within the shared 30 s range.
 */
function constantOffsetOf(result: Extract<AnalysisResult, { kind: 'aligned' }>, bars: readonly BarSpan[]): TakeVerdict {
  if (result.tier !== 'lined-up') return noMatch('not-confident');
  const anchored = result.map.anchorData;
  if (!anchored || result.map.holds.length > 0 || result.skippedStretches > 0 || bars.length === 0 || anchored.anchors.length !== bars.length) {
    return noMatch('inconsistent');
  }
  const offsets = bars.map((bar, k) => anchored.anchors[k] - bar.start);
  offsets.push(anchored.endAnchor - bars[bars.length - 1].end);
  const middle = median(offsets);
  if (offsets.some((d) => Math.abs(d - middle) > TAKE_TOLERANCE_SECONDS)) return noMatch('inconsistent');
  if (Math.abs(middle) > OFFSET_MAX_SECONDS) return noMatch('out-of-range');
  return { kind: 'offset', offset: clampOffset(Math.round(middle * 1000) / 1000) };
}

/** What a finished analysis means for a take, against the tab's played bars. */
export function takeVerdict(result: AnalysisResult, bars: readonly BarSpan[]): TakeJudged {
  switch (result.kind) {
    case 'aligned':
      return constantOffsetOf(result, bars);
    case 'not-found':
      return noMatch(result.reason);
    case 'failed':
      return { kind: 'failed', reason: result.reason };
    case 'cancelled':
      return { kind: 'cancelled' };
  }
}

/** What to remember about a judged take: its verdict, stamped with this revision and the tab it was judged against. */
export function recordForTake(verdict: TakeVerdict, bars: readonly BarSpan[]): AlignmentRecord {
  return { source: 'auto', holds: [], revision: TAKE_REVISION, fingerprint: tabFingerprint(bars), take: verdict };
}

/**
 * The record after the player nudged a lined-up take: the stored offset becomes the new one, and the detected offset is kept
 * as the previous value (only the first time, so a second nudge does not lose it). With nothing remembered yet, a record is made.
 */
export function withNudge(record: AlignmentRecord | undefined, offset: number, bars?: readonly BarSpan[]): AlignmentRecord {
  const next = clampOffset(offset);
  const base = record ?? (bars ? recordForTake({ kind: 'offset', offset: next }, bars) : { source: 'auto' as const, holds: [] });
  const detected = base.take?.kind === 'offset' ? base.take.offset : undefined;
  const previousOffset = base.previousOffset ?? detected;
  return { ...base, take: { kind: 'offset', offset: next }, ...(previousOffset !== undefined ? { previousOffset } : {}) };
}

/** What happens when a take is opened, from what is remembered for its video. */
export type TakeOpenDecision =
  /** A remembered offset for this revision and tab: use it, with no analysis. */
  | { readonly action: 'reuse'; readonly offset: number }
  /** A no-match already found for this revision and tab: say so and do not repeat it until asked. */
  | { readonly action: 'stay'; readonly reason: TakeNoMatchReason }
  /** Nothing usable remembered: judge the take. */
  | { readonly action: 'detect' };

export function decideTakeOnOpen(record: AlignmentRecord | null | undefined, bars: readonly BarSpan[]): TakeOpenDecision {
  const take = record?.take;
  if (!record || !take || record.revision !== TAKE_REVISION || record.fingerprint !== tabFingerprint(bars)) return { action: 'detect' };
  return take.kind === 'offset' ? { action: 'reuse', offset: take.offset } : { action: 'stay', reason: take.reason };
}

const LEAD = "This doesn't line up with the tab. Try the next result.";

/** What the player is told when a take does not line up; the cause is named when it is known (R5). */
export function takeNoMatchText(reason: TakeNoMatchReason): string {
  switch (reason) {
    case 'too-long':
      return `${LEAD} The take or the tab is too long to line up automatically.`;
    case 'silent':
      return `${LEAD} The take or the tab has no sound to compare.`;
    case 'out-of-range':
      return `${LEAD} The take starts more than ${OFFSET_MAX_SECONDS} seconds away from the tab.`;
    case 'not-confident':
      return `${LEAD} Too little of the take matched the tab.`;
    case 'inconsistent':
      return `${LEAD} The take does not keep step with the tab all the way through.`;
  }
}

/** What the player is told when the check itself could not run; that is not a no-match, and the take was not played. */
export function takeFailedText(reason: 'decode' | 'render' | 'worker' | 'no-sound'): string {
  const why =
    reason === 'decode' ? 'its audio could not be read'
    : reason === 'render' || reason === 'no-sound' ? 'the tab could not be played to compare'
    : 'the comparison stopped unexpectedly';
  return `The take could not be checked against the tab because ${why}. It was not played. Try again.`;
}
