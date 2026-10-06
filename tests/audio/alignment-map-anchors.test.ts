import { describe, expect, it } from 'vitest';
import { AlignmentMap, HOLD_DISPLAY_SECONDS } from '../../src/audio/alignment-map';

/** Six bars of 2 s. */
const bars = Array.from({ length: 6 }, (_, i) => ({ start: i * 2, end: i * 2 + 2 }));

/**
 * The plan's table: the band ran a little slow in bar 1, fast in bar 3, and played 8 s of extra material after
 * bar 5. Anchors are recording seconds at which each bar starts; the tab ends at 21.3.
 */
const drifting = () => AlignmentMap.fromAnchors(bars, [1.5, 3.6, 5.6, 7.3, 9.3, 19.3], 21.3)!;

describe('AlignmentMap with anchors', () => {
  it('runs steadily inside a bar, waits on the line when the bar ran long, and steps forward when it ran short', () => {
    const map = drifting();
    expect(map.toTab(1.5)).toBeCloseTo(0, 9);
    expect(map.toTab(2.5)).toBeCloseTo(1, 9);
    // bar 1 took 2.1 s: the tab waits 0.1 s on the line
    expect(map.toTab(3.5)).toBeCloseTo(2 - HOLD_DISPLAY_SECONDS, 9);
    expect(map.toTab(3.6)).toBeCloseTo(2, 9);
    // bar 3 took 1.7 s: the tab runs 1.7 s and then steps forward to the line
    expect(map.toTab(7.29)).toBeCloseTo(6 - 0.01 - (2 - 1.7), 9 - 0);
    expect(map.toTab(7.3)).toBeCloseTo(6, 9);
  });

  it('covers AE3: eight seconds of extra playing make the tab wait on the line, then rejoin at the next anchor', () => {
    const map = drifting();
    expect(map.toTab(9.3)).toBeCloseTo(8, 9);
    expect(map.toTab(11.2)).toBeCloseTo(9.9, 9);
    expect(map.toTab(11.3)).toBeCloseTo(10 - HOLD_DISPLAY_SECONDS, 9);
    expect(map.toTab(15)).toBeCloseTo(10 - HOLD_DISPLAY_SECONDS, 9);
    expect(map.toTab(19.29)).toBeCloseTo(10 - HOLD_DISPLAY_SECONDS, 9);
    expect(map.toTab(19.3)).toBeCloseTo(10, 9);
    expect(map.holds).toHaveLength(1);
    expect(map.holds[0].at).toBe(10);
    expect(map.holds[0].length).toBeCloseTo(8, 9);
    expect(map.totalHold).toBeCloseTo(8, 9);
  });

  it('continues one to one before the first anchor and after the end anchor', () => {
    const map = drifting();
    expect(map.toTab(0)).toBeCloseTo(-1.5, 9);
    expect(map.toTab(21.3)).toBeCloseTo(12, 9);
    expect(map.toTab(22)).toBeCloseTo(12.7, 9);
    expect(map.toRec(-1, 'start')).toBeCloseTo(0.5, 9);
    expect(map.toRec(12, 'start')).toBeCloseTo(21.3, 9);
    expect(map.toRec(13, 'start')).toBeCloseTo(22.3, 9);
  });

  it('puts a tab time back on the recording through the bar anchor, with the arrival and the rejoin at a line', () => {
    const map = drifting();
    expect(map.toRec(0, 'start')).toBeCloseTo(1.5, 9);
    expect(map.toRec(1, 'start')).toBeCloseTo(2.5, 9);
    expect(map.toRec(2, 'start')).toBeCloseTo(3.6, 9);
    // the tab reaches the line at bar 1's end (3.5) before the recording gets to its anchor (3.6)
    expect(map.toRec(2, 'end')).toBeCloseTo(3.5, 9);
    // bar 3 ran short: the tab never reaches the line on its own, so the arrival is the next anchor
    expect(map.toRec(6, 'start')).toBeCloseTo(7.3, 9);
    expect(map.toRec(6, 'end')).toBeCloseTo(7.3, 9);
    // the extra playing sits between the arrival and the rejoin
    expect(map.toRec(10, 'end')).toBeCloseTo(11.3, 9);
    expect(map.toRec(10, 'start')).toBeCloseTo(19.3, 9);
  });

  it('covers AE4: bars the recording skips have no recorded length, and the tab steps through them', () => {
    const skipping = AlignmentMap.fromAnchors(bars, [0, 2, 4, 4, 4, 6], 8)!;
    expect(skipping.toTab(3.9)).toBeCloseTo(3.9, 9);
    expect(skipping.toTab(4)).toBeCloseTo(8, 9);
    expect(skipping.holds).toEqual([]);
    // a seek into a skipped bar goes no further than the recording gets to
    expect(skipping.toRec(5, 'start')).toBeCloseTo(4, 9);
  });

  it('says when the recording is inside a wait', () => {
    const map = drifting();
    expect(map.inHold(9.3)).toBe(false);
    expect(map.inHold(11.2)).toBe(false);
    expect(map.inHold(11.3)).toBe(true);
    expect(map.inHold(15)).toBe(true);
    expect(map.inHold(19.3)).toBe(false);
  });

  it('gives the output length: the span of the recording over the tab', () => {
    expect(drifting().outputLength(12)).toBeCloseTo(21.3 - 1.5, 9);
    expect(AlignmentMap.of(1.5, [{ at: 4, length: 3 }]).outputLength(12)).toBeCloseTo(15, 9);
    expect(AlignmentMap.fromOffset(2).outputLength(12)).toBe(12);
  });

  it('is not given another base offset: a timeline of per-bar positions is committed whole, and the offset belongs to the form without one', () => {
    const map = drifting();
    const moved = map.withBase(2.5);
    expect(moved).toBe(map);
    expect(moved.toRec(2, 'start')).toBeCloseTo(map.toRec(2, 'start'), 9);
    expect(AlignmentMap.of(1, []).withBase(2.5).base).toBeCloseTo(2.5, 9);
  });

  it('refuses anchors that do not fit the bars and repairs a decreasing run', () => {
    expect(AlignmentMap.fromAnchors(bars, [0, 2, 4], 8)).toBeNull();
    expect(AlignmentMap.fromAnchors(bars, [0, 2, 4, 6, Number.NaN, 10], 12)).toBeNull();
    expect(AlignmentMap.fromAnchors(bars, [0, 2, 4, 6, 8, 10], Number.POSITIVE_INFINITY)).toBeNull();
    const repaired = AlignmentMap.fromAnchors(bars, [0, 3, 2, 6, 8, 10], 12)!;
    expect(repaired.toRec(4, 'start')).toBeCloseTo(3, 9);
    expect(AlignmentMap.fromAnchors([], [], 0)).toBeNull();
  });

  it('round-trips through plain data with its bars', () => {
    const map = drifting();
    const again = AlignmentMap.normalize(map.toData())!;
    expect(again.toData()).toEqual(map.toData());
    expect(again.toRec(10, 'start')).toBeCloseTo(19.3, 9);
    expect(AlignmentMap.normalize({ base: 1, anchors: [1, 2], endAnchor: 3, bars: [{ start: 0, end: 'x' }] })?.holds).toEqual([]);
  });

  it('is still the first form when it has no bars', () => {
    const first = AlignmentMap.of(1.5, [{ at: 40, length: 8 }]);
    expect(first.hasAnchors).toBe(false);
    expect(drifting().hasAnchors).toBe(true);
  });
});
