import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../src/alignment/analyze';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { tabFingerprint } from '../../src/audio/tab-fingerprint';
import {
  decideTakeOnOpen,
  recordForTake,
  stepAfterJudge,
  stepAfterPrecheck,
  takeFailedText,
  takeNoMatchText,
  takeVerdict,
  TAKE_REVISION,
  TAKE_TOLERANCE_SECONDS,
  withNudge,
} from '../../src/app/take-align';
import type { AlignmentRecord } from '../../src/audio/recording-profile';

const bars = Array.from({ length: 6 }, (_, i) => ({ start: i * 2, end: i * 2 + 2 }));
const endOf = (offset: number) => 12 + offset;
/** The map a take placed `offset` seconds late would get: every bar starts `offset` after the tab's bar. */
const shiftedBy = (offset: number, jitter: readonly number[] = [0, 0, 0, 0, 0, 0]) =>
  AlignmentMap.fromAnchors(bars, bars.map((b, i) => b.start + offset + jitter[i]), endOf(offset))!;

const aligned = (over: Partial<Extract<AnalysisResult, { kind: 'aligned' }>> = {}): AnalysisResult => ({
  kind: 'aligned',
  map: shiftedBy(12),
  perBarMap: shiftedBy(12),
  tier: 'lined-up',
  confidence: 6,
  matchedFraction: 1,
  skippedStretches: 0,
  barConfidence: [],
  barMatched: [],
  sections: [],
  ...over,
});

describe('takeVerdict', () => {
  it('covers AE1: a result whose every bar sits 12 s after the tab bar is an offset of 12', () => {
    expect(takeVerdict(aligned(), bars)).toEqual({ kind: 'offset', offset: 12 });
  });

  it('reads a negative offset (the take starts after the tab)', () => {
    expect(takeVerdict(aligned({ map: shiftedBy(-3) }), bars)).toEqual({ kind: 'offset', offset: -3 });
  });

  it('covers AE2: a take with an extra section (the offsets step up partway) is not an offset', () => {
    // From the fourth bar on the take is 8 s further behind, as when a section was inserted.
    const anchors = [12, 14, 16, 26, 28, 30];
    const extra = AlignmentMap.fromAnchors(bars, anchors, 32)!;
    expect(takeVerdict(aligned({ map: extra }), bars)).toEqual({ kind: 'no-match', reason: 'inconsistent' });
  });

  it('is not an offset when the offsets drift linearly (a slightly faster take), even though the first bar looks right', () => {
    const drifting = AlignmentMap.fromAnchors(bars, [1.5, 3.4, 5.3, 7.2, 9.1, 11], 12.9)!;
    expect(takeVerdict(aligned({ map: drifting }), bars)).toEqual({ kind: 'no-match', reason: 'inconsistent' });
  });

  it('is not an offset when a bar has a hold (the take plays a bar at least a second longer)', () => {
    const held = AlignmentMap.fromAnchors(bars, [1.5, 3.5, 6.5, 8.5, 10.5, 12.5], 14.5)!;
    expect(held.holds.length).toBeGreaterThan(0);
    expect(takeVerdict(aligned({ map: held }), bars)).toEqual({ kind: 'no-match', reason: 'inconsistent' });
  });

  it('is not an offset when the take skips a stretch of the tab', () => {
    expect(takeVerdict(aligned({ skippedStretches: 1 }), bars)).toEqual({ kind: 'no-match', reason: 'inconsistent' });
  });

  it('is not an offset in the roughly tier (doubt means no match)', () => {
    expect(takeVerdict(aligned({ tier: 'roughly' }), bars)).toEqual({ kind: 'no-match', reason: 'not-confident' });
  });

  it('is not an offset when the map has no bar positions to check the offset against', () => {
    expect(takeVerdict(aligned({ map: AlignmentMap.of(12, []) }), bars)).toEqual({ kind: 'no-match', reason: 'inconsistent' });
  });

  it('accepts bar offsets within the tolerance of their median and rejects one just outside it', () => {
    const inside = TAKE_TOLERANCE_SECONDS - 0.01;
    const outside = TAKE_TOLERANCE_SECONDS + 0.02;
    expect(takeVerdict(aligned({ map: shiftedBy(12, [0, inside, 0, -inside, 0, 0]) }), bars).kind).toBe('offset');
    expect(takeVerdict(aligned({ map: shiftedBy(12, [0, outside, 0, 0, 0, 0]) }), bars)).toEqual({ kind: 'no-match', reason: 'inconsistent' });
  });

  it('does not judge the take by where its end anchor sits (the end is read off a coarser grid than the bars)', () => {
    const lateEnd = AlignmentMap.fromAnchors(bars, bars.map((b) => b.start + 12), endOf(12) + 0.2)!;
    expect(takeVerdict(aligned({ map: lateEnd }), bars)).toEqual({ kind: 'offset', offset: 12 });
  });

  it('averages the two middle offsets when there is an even number of them', () => {
    const four = bars.slice(0, 4);
    const anchors = [12, 14, 16.02, 18.02];
    const map = AlignmentMap.fromAnchors(four, anchors, 20)!;
    const verdict = takeVerdict(aligned({ map }), four);
    expect(verdict.kind).toBe('offset');
    if (verdict.kind === 'offset') expect(verdict.offset).toBeCloseTo(12.01, 3);
  });

  it('plays an accepted take within the tolerance of every bar the analysis found (the residual against the per-bar anchors)', () => {
    // A take about 0.4% slow: its bars drift by a few hundredths over the song, and it is still one offset.
    const jitter = [0, 0.005, 0.01, 0.015, 0.02, 0.02];
    const map = shiftedBy(12, jitter);
    const verdict = takeVerdict(aligned({ map }), bars);
    expect(verdict.kind).toBe('offset');
    if (verdict.kind !== 'offset') return;
    const played = AlignmentMap.fromOffset(verdict.offset);
    const anchors = map.anchorData!.anchors;
    const worst = Math.max(...bars.map((bar, k) => Math.abs(played.toRec(bar.start, 'start') - anchors[k])));
    expect(worst).toBeLessThanOrEqual(TAKE_TOLERANCE_SECONDS);
  });

  it('rejects a take about 1% slow, whose bars drift past what one offset can follow', () => {
    const jitter = bars.map((_, k) => k * 0.04);
    expect(takeVerdict(aligned({ map: shiftedBy(12, jitter) }), bars)).toEqual({ kind: 'no-match', reason: 'inconsistent' });
  });

  it('keeps the tolerance workable for anchors that are rounded to 10 ms', () => {
    expect(TAKE_TOLERANCE_SECONDS).toBeGreaterThanOrEqual(0.02);
    expect(TAKE_TOLERANCE_SECONDS).toBeLessThanOrEqual(0.03);
  });

  it('covers AE3: an offset beyond 30 s is out of range', () => {
    expect(takeVerdict(aligned({ map: shiftedBy(45) }), bars)).toEqual({ kind: 'no-match', reason: 'out-of-range' });
    expect(takeVerdict(aligned({ map: shiftedBy(-45) }), bars)).toEqual({ kind: 'no-match', reason: 'out-of-range' });
  });

  it('passes the analysis\'s own not-found reasons through', () => {
    for (const reason of ['too-long', 'silent', 'not-confident', 'out-of-range'] as const) {
      expect(takeVerdict({ kind: 'not-found', reason }, bars)).toEqual({ kind: 'no-match', reason });
    }
  });

  it('reports a failed check as failed, not as a no-match, and a cancelled one as cancelled', () => {
    expect(takeVerdict({ kind: 'failed', reason: 'worker' }, bars)).toEqual({ kind: 'failed', reason: 'worker' });
    expect(takeVerdict({ kind: 'cancelled' }, bars)).toEqual({ kind: 'cancelled' });
  });
});

describe('what a take is remembered as', () => {
  const fingerprint = tabFingerprint(bars);

  it('records an offset with the current revision and the tab\'s fingerprint, and no holds or anchors', () => {
    expect(recordForTake({ kind: 'offset', offset: 12 }, bars)).toEqual({ source: 'auto', holds: [], revision: TAKE_REVISION, fingerprint, take: { kind: 'offset', offset: 12 } });
  });

  it('records a no-match with its reason', () => {
    expect(recordForTake({ kind: 'no-match', reason: 'silent' }, bars).take).toEqual({ kind: 'no-match', reason: 'silent' });
  });

  it('a nudge overwrites the stored offset and keeps the detected one as the previous value', () => {
    const detected = recordForTake({ kind: 'offset', offset: 12 }, bars);
    const nudged = withNudge(detected, 12.2);
    expect(nudged.take).toEqual({ kind: 'offset', offset: 12.2 });
    expect(nudged.previousOffset).toBe(12);
  });

  it('a second nudge keeps the first detected value, not the previous nudge', () => {
    const nudged = withNudge(withNudge(recordForTake({ kind: 'offset', offset: 12 }, bars), 12.2), 12.5);
    expect(nudged.take).toEqual({ kind: 'offset', offset: 12.5 });
    expect(nudged.previousOffset).toBe(12);
  });

  it('a nudge after a remembered no-match makes it an offset, with no previous value to keep', () => {
    const rejected = recordForTake({ kind: 'no-match', reason: 'inconsistent' }, bars);
    const nudged = withNudge(rejected, 3);
    expect(nudged.take).toEqual({ kind: 'offset', offset: 3 });
    expect(nudged).not.toHaveProperty('previousOffset');
  });

  it('a nudge with no record yet makes one that holds the offset', () => {
    expect(withNudge(undefined, 3, bars).take).toEqual({ kind: 'offset', offset: 3 });
  });
});

describe('decideTakeOnOpen', () => {
  const fingerprint = tabFingerprint(bars);
  const stored = (over: Partial<AlignmentRecord> = {}): AlignmentRecord => ({ source: 'auto', holds: [], revision: TAKE_REVISION, fingerprint, take: { kind: 'offset', offset: 12 }, ...over });

  it('covers AE4: a remembered offset for the same revision and tab is reused', () => {
    expect(decideTakeOnOpen(stored(), bars)).toEqual({ action: 'reuse', offset: 12 });
  });

  it('covers AE5: the same record against an edited tab is checked again', () => {
    const edited = bars.map((b, i) => (i === 5 ? { ...b, end: b.end + 0.5 } : b));
    expect(decideTakeOnOpen(stored(), edited)).toEqual({ action: 'detect' });
  });

  it('stays on a remembered no-match for the same tab and says why', () => {
    expect(decideTakeOnOpen(stored({ take: { kind: 'no-match', reason: 'inconsistent' } }), bars)).toEqual({ action: 'stay', reason: 'inconsistent' });
  });

  it('checks again a remembered no-match when the tab changed', () => {
    const edited = bars.slice(0, 5);
    expect(decideTakeOnOpen(stored({ take: { kind: 'no-match', reason: 'inconsistent' } }), edited)).toEqual({ action: 'detect' });
  });

  it('checks again a record from an older revision', () => {
    expect(decideTakeOnOpen(stored({ revision: TAKE_REVISION - 1 }), bars)).toEqual({ action: 'detect' });
    expect(decideTakeOnOpen(stored({ revision: undefined }), bars)).toEqual({ action: 'detect' });
  });

  it('checks again when nothing is remembered, or the record has no take outcome', () => {
    expect(decideTakeOnOpen(undefined, bars)).toEqual({ action: 'detect' });
    expect(decideTakeOnOpen(null, bars)).toEqual({ action: 'detect' });
    expect(decideTakeOnOpen({ source: 'auto', holds: [], revision: TAKE_REVISION, fingerprint }, bars)).toEqual({ action: 'detect' });
  });
});

describe('what the player is told', () => {
  const LEAD = "This doesn't line up with the tab. Try the next result.";

  it('every no-match reason has its own text that starts with the plain message', () => {
    const reasons = ['too-long', 'silent', 'not-confident', 'out-of-range', 'inconsistent'] as const;
    const texts = reasons.map((r) => takeNoMatchText(r));
    for (const text of texts) {
      expect(text.startsWith(LEAD)).toBe(true);
      expect(text).not.toMatch(/offset alone|plays against/i);
    }
    expect(new Set(texts).size).toBe(reasons.length);
  });

  it('covers AE3: an out-of-range take is told it starts too far from the tab', () => {
    expect(takeNoMatchText('out-of-range')).toMatch(/starts more than 30 seconds away from the tab/);
  });

  it('names a tab or take that is too long, and one with no sound', () => {
    expect(takeNoMatchText('too-long')).toMatch(/too long/);
    expect(takeNoMatchText('silent')).toMatch(/no sound/);
  });

  it('says a check that could not run was not a no-match, and that the take was not played', () => {
    for (const reason of ['decode', 'render', 'worker', 'no-sound'] as const) {
      const text = takeFailedText(reason);
      expect(text).toMatch(/could not be checked/i);
      expect(text).not.toBe(LEAD);
    }
  });
});

describe('stepAfterJudge', () => {
  it('activates a take that lined up, with its offset', () => {
    expect(stepAfterJudge({ kind: 'offset', offset: 12 })).toEqual({ step: 'activate', offset: 12 });
  });

  it('covers AE2: shows the no-match message for a take that does not line up, with no way to activate it', () => {
    const step = stepAfterJudge({ kind: 'no-match', reason: 'inconsistent' });
    expect(step).toEqual({ step: 'show', text: takeNoMatchText('inconsistent'), canRecheck: false });
  });

  it('says a check that could not run was not a no-match, and does not activate the take', () => {
    expect(stepAfterJudge({ kind: 'failed', reason: 'worker' })).toEqual({ step: 'error', text: takeFailedText('worker') });
  });

  it('drops a cancelled check with no message', () => {
    expect(stepAfterJudge({ kind: 'cancelled' })).toEqual({ step: 'drop' });
  });
});

describe('stepAfterPrecheck', () => {
  it('goes on to load the stems and judge them when nothing is remembered', () => {
    expect(stepAfterPrecheck({ action: 'detect' })).toEqual({ step: 'load', offset: null });
  });

  it('covers AE4: loads the stems and uses a remembered offset without judging', () => {
    expect(stepAfterPrecheck({ action: 'reuse', offset: 12.2 })).toEqual({ step: 'load', offset: 12.2 });
  });

  it('shows a remembered no-match with its reason and offers to check again, without downloading', () => {
    expect(stepAfterPrecheck({ action: 'stay', reason: 'out-of-range' })).toEqual({ step: 'show', text: takeNoMatchText('out-of-range'), canRecheck: true });
  });
});
