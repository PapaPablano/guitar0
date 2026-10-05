import { describe, expect, it } from 'vitest';
import { AlignmentMap, HOLD_DISPLAY_SECONDS } from '../../src/audio/alignment-map';

/** Base 1.5 s and one hold of 8.2 s on the bar line at tab 40 s (the plan's example table). */
const example = () => AlignmentMap.of(1.5, [{ at: 40, length: 8.2 }]);

describe('AlignmentMap', () => {
  it('turns a recording position into a tab time through the base offset and the hold', () => {
    const map = example();
    expect(map.toTab(1.5)).toBeCloseTo(0, 9);
    expect(map.toTab(41.4)).toBeCloseTo(39.9, 9);
    // the tab waits 1 ms before the bar line while the extra playing goes by
    expect(map.toTab(41.5)).toBeCloseTo(40 - HOLD_DISPLAY_SECONDS, 9);
    expect(map.toTab(45)).toBeCloseTo(40 - HOLD_DISPLAY_SECONDS, 9);
    expect(map.toTab(49.69)).toBeCloseTo(40 - HOLD_DISPLAY_SECONDS, 9);
    expect(map.toTab(49.7)).toBeCloseTo(40, 9);
    expect(map.toTab(54.7)).toBeCloseTo(45, 9);
  });

  it('puts a tab time back on the recording from either side of a hold', () => {
    const map = example();
    expect(map.toRec(40, 'end')).toBeCloseTo(41.5, 9);
    expect(map.toRec(40, 'start')).toBeCloseTo(49.7, 9);
    expect(map.toRec(45, 'start')).toBeCloseTo(54.7, 9);
    expect(map.toRec(45, 'end')).toBeCloseTo(54.7, 9);
    expect(map.toRec(10, 'start')).toBeCloseTo(11.5, 9);
  });

  it('behaves as the single offset when there are no holds', () => {
    const map = AlignmentMap.fromOffset(-2);
    for (const tab of [0, 3.25, 100]) {
      expect(map.toRec(tab, 'start')).toBeCloseTo(tab - 2, 9);
      expect(map.toRec(tab, 'end')).toBeCloseTo(tab - 2, 9);
    }
    expect(map.toTab(-2)).toBeCloseTo(0, 9);
    expect(map.toTab(7)).toBeCloseTo(9, 9);
  });

  it('converts negative recording positions the same way as positive ones', () => {
    const map = AlignmentMap.of(-3, [{ at: 20, length: 4 }]);
    expect(map.toTab(-3)).toBeCloseTo(0, 9);
    expect(map.toTab(-1)).toBeCloseTo(2, 9);
    expect(map.toRec(0, 'start')).toBeCloseTo(-3, 9);
  });

  it('folds a hold at tab zero into the base offset and merges holds on the same bar line', () => {
    const folded = AlignmentMap.of(1, [{ at: 0, length: 2 }, { at: 10, length: 1 }, { at: 10, length: 0.5 }]);
    expect(folded.base).toBeCloseTo(3, 9);
    expect(folded.holds).toEqual([{ at: 10, length: 1.5 }]);
  });

  it('sorts holds and drops ones that are not usable, clamping the base offset', () => {
    const map = AlignmentMap.of(99, [
      { at: 30, length: 2 },
      { at: 10, length: 1 },
      { at: Number.NaN, length: 1 },
      { at: 20, length: -4 },
      { at: 25, length: Number.POSITIVE_INFINITY },
      { at: 40, length: 0 },
    ]);
    expect(map.base).toBe(30);
    expect(map.holds).toEqual([
      { at: 10, length: 1 },
      { at: 30, length: 2 },
    ]);
  });

  it('reads untrusted data and refuses anything that is not a map', () => {
    expect(AlignmentMap.normalize(null)).toBeNull();
    expect(AlignmentMap.normalize('x')).toBeNull();
    expect(AlignmentMap.normalize({ base: 'a', holds: [] })).toBeNull();
    const map = AlignmentMap.normalize({ base: 1, holds: [{ at: 5, length: 2 }, 'junk', { at: 'x' }] });
    expect(map?.holds).toEqual([{ at: 5, length: 2 }]);
    expect(AlignmentMap.normalize({ base: 1 })?.holds).toEqual([]);
  });

  it('removes a hold, shifting later positions back by its length', () => {
    const map = example();
    const without = map.withoutHold(0);
    expect(without.holds).toEqual([]);
    expect(without.toRec(45, 'start')).toBeCloseTo(46.5, 9);
    // reverting to the plain offset is the same as removing every hold
    expect(without.toRec(45, 'start')).toBeCloseTo(AlignmentMap.fromOffset(1.5).toRec(45, 'start'), 9);
  });

  it('resizes a hold and changes the base offset without touching the original', () => {
    const map = example();
    const longer = map.withHoldLength(0, 8.3);
    expect(longer.holds[0].length).toBeCloseTo(8.3, 9);
    expect(map.holds[0].length).toBe(8.2);
    expect(map.withBase(2).toRec(0, 'start')).toBeCloseTo(2, 9);
    expect(map.withBase(2).holds).toEqual(map.holds);
  });

  it('adds a hold in order and adds its length to one already on that bar line', () => {
    const map = example().withHold({ at: 20, length: 3 }).withHold({ at: 40, length: 1 });
    expect(map.holds).toEqual([
      { at: 20, length: 3 },
      { at: 40, length: 9.2 },
    ]);
  });

  it('adds up the length of every hold', () => {
    expect(AlignmentMap.of(0, [{ at: 5, length: 2 }, { at: 9, length: 1.5 }]).totalHold).toBeCloseTo(3.5, 9);
  });

  it('says whether a recording position is inside extra playing', () => {
    const map = example();
    expect(map.inHold(41.4)).toBe(false);
    expect(map.inHold(41.5)).toBe(true);
    expect(map.inHold(45)).toBe(true);
    expect(map.inHold(49.7)).toBe(false);
    expect(AlignmentMap.fromOffset(1).inHold(10)).toBe(false);
  });

  it('round-trips through plain data', () => {
    const map = example();
    expect(AlignmentMap.normalize(map.toData())?.toData()).toEqual(map.toData());
  });
});
