import type { BarSpan } from '../audio/alignment-map';
import { OFFSET_MAX_SECONDS } from '../audio/offset-range';

/**
 * The whole-song consistency check on a finished timeline's raw anchors, run before they become the timeline in use. It
 * is a pure function over the bars and anchors, so a failure can say which bar broke which rule.
 */

/** Tuning; the reason for each value is beside it. */
export const TIMELINE_CHECK = {
  /** A bar the recording plays for less than this, but not for nothing, is neither played nor skipped. A skipped bar has exactly no length of its own. */
  minBarSeconds: 0.05,
  /** Most extra playing a single bar may hold, in seconds: past this the path ran away rather than found a part the band added. */
  maxExtraSeconds: 600,
  /** Slack on a skipped bar sharing the next bar's anchor, in seconds (anchors are rounded to 10 ms). */
  sharedSeconds: 0.005,
} as const;

export type TimelineProblem =
  | { readonly kind: 'count'; readonly bar: -1; readonly detail: string }
  | { readonly kind: 'not-finite' | 'decreasing' | 'too-short' | 'too-long' | 'out-of-range'; readonly bar: number; readonly detail: string };

export type CheckOptions = { readonly [K in keyof typeof TIMELINE_CHECK]: number };

/** What is wrong with the anchors, or an empty list when they make a consistent timeline. */
export function checkTimeline(
  bars: readonly BarSpan[],
  anchors: readonly number[],
  endAnchor: number,
  options: Partial<CheckOptions> = {},
): TimelineProblem[] {
  const o: CheckOptions = { ...TIMELINE_CHECK, ...options };
  const problems: TimelineProblem[] = [];
  if (bars.length === 0 || anchors.length !== bars.length) {
    problems.push({ kind: 'count', bar: -1, detail: `${anchors.length} anchors for ${bars.length} bars` });
    return problems;
  }
  for (let k = 0; k < bars.length; k++) {
    if (!Number.isFinite(anchors[k])) problems.push({ kind: 'not-finite', bar: k, detail: `bar ${k + 1} has no position` });
  }
  if (!Number.isFinite(endAnchor)) problems.push({ kind: 'not-finite', bar: bars.length - 1, detail: 'the end has no position' });
  if (problems.length > 0) return problems;
  if (Math.abs(anchors[0] - bars[0].start) > OFFSET_MAX_SECONDS) {
    problems.push({ kind: 'out-of-range', bar: 0, detail: 'the recording starts further from the tab than the offset range allows' });
  }
  for (let k = 0; k < bars.length; k++) {
    const next = k + 1 < bars.length ? anchors[k + 1] : endAnchor;
    const recorded = next - anchors[k];
    const tabLength = bars[k].end - bars[k].start;
    if (recorded < -o.sharedSeconds) {
      problems.push({ kind: 'decreasing', bar: k, detail: `bar ${k + 1} ends ${(-recorded).toFixed(2)} s before it starts` });
    } else if (recorded > o.sharedSeconds && recorded < o.minBarSeconds) {
      problems.push({ kind: 'too-short', bar: k, detail: `bar ${k + 1} is ${recorded.toFixed(2)} s long, too short to be played` });
    } else if (recorded - tabLength > o.maxExtraSeconds) {
      problems.push({ kind: 'too-long', bar: k, detail: `bar ${k + 1} holds ${(recorded - tabLength).toFixed(0)} s of extra playing` });
    }
  }
  return problems;
}

/** A timeline is lined up when most bars are supported, and only roughly lined up otherwise. */
export type OutcomeTier = 'lined-up' | 'roughly';

/** Starting thresholds, to be calibrated on the owner's song (see `dev/real-song-spike.ts`). */
export const TIER = {
  /** A bar is supported when its own onsets agree with its place, or the whole-song pass is this sure of it, in seconds of standard deviation. */
  supportedSpreadSeconds: 0.025,
  /** The share of played bars that must be supported for the timeline to count as lined up. */
  linedUpShare: 0.8,
} as const;

/**
 * The outcome of a committed timeline. A bar is supported when its own onsets agree with where the whole-song pass put
 * it, or when the pass is sure of it to within `supportedSpreadSeconds`; bars the recording skips are not counted.
 */
export function outcomeTier(
  uncertainty: readonly number[],
  evidenceAgrees: readonly boolean[],
  anchors: readonly number[],
  endAnchor: number,
  options: Partial<{ [K in keyof typeof TIER]: number }> = {},
): OutcomeTier {
  const o = { ...TIER, ...options };
  let played = 0;
  let supported = 0;
  for (let k = 0; k < anchors.length; k++) {
    const next = k + 1 < anchors.length ? anchors[k + 1] : endAnchor;
    if (next - anchors[k] < TIMELINE_CHECK.sharedSeconds) continue;
    played += 1;
    if (evidenceAgrees[k] || uncertainty[k] <= o.supportedSpreadSeconds) supported += 1;
  }
  return played > 0 && supported / played >= o.linedUpShare ? 'lined-up' : 'roughly';
}
