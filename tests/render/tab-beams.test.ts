import { describe, expect, it } from 'vitest';
import { beatTicksFor, flagCount, planBeams } from '../../src/render/tab-beams';

const FOUR_FOUR = { numerator: 4, denominator: 4 };
const SIX_EIGHT = { numerator: 6, denominator: 8 };

const on = (tick: number, durationTicks: number) => ({ tick, durationTicks });

describe('flagCount', () => {
  it('counts one flag per halving below a quarter note', () => {
    expect(flagCount(960)).toBe(0);
    expect(flagCount(1920)).toBe(0);
    expect(flagCount(480)).toBe(1);
    expect(flagCount(240)).toBe(2);
    expect(flagCount(120)).toBe(3);
  });

  it('rounds a dotted eighth to one flag', () => {
    expect(flagCount(720)).toBe(1);
  });

  it('gives a dotted or triplet note the flags of the plain note it is made from', () => {
    expect(flagCount(640)).toBe(0); // quarter triplet
    expect(flagCount(320)).toBe(1); // eighth triplet
    expect(flagCount(160)).toBe(2); // sixteenth triplet
    expect(flagCount(360)).toBe(2); // dotted sixteenth
    expect(flagCount(30)).toBe(3); // nothing shorter than three flags
  });
});

describe('beatTicksFor', () => {
  it('takes the beat from the denominator and uses dotted quarters for compound meters', () => {
    expect(beatTicksFor(FOUR_FOUR)).toBe(960);
    expect(beatTicksFor({ numerator: 3, denominator: 4 })).toBe(960);
    expect(beatTicksFor({ numerator: 6, denominator: 8 })).toBe(1440);
    expect(beatTicksFor({ numerator: 7, denominator: 8 })).toBe(480);
  });
});

describe('planBeams', () => {
  it('beams two eighths that share a quarter-note beat', () => {
    const plan = planBeams([on(0, 480), on(480, 480)], 0, FOUR_FOUR);
    expect(plan.groups.map((g) => g.members)).toEqual([[0, 1]]);
    expect(plan.flagged).toEqual([]);
  });

  it('splits four eighths across two beats into two groups', () => {
    const plan = planBeams([on(0, 480), on(480, 480), on(960, 480), on(1440, 480)], 0, FOUR_FOUR);
    expect(plan.groups.map((g) => g.members)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('adds a second-level beam over four sixteenths in a beat', () => {
    const plan = planBeams([on(0, 240), on(240, 240), on(480, 240), on(720, 240)], 0, FOUR_FOUR);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].members).toEqual([0, 1, 2, 3]);
    expect(plan.groups[0].segments).toEqual([{ level: 2, from: 0, to: 3 }]);
  });

  it('beams a second level only over the sixteenths of a mixed beat', () => {
    const plan = planBeams([on(0, 480), on(480, 240), on(720, 240)], 0, FOUR_FOUR);
    expect(plan.groups[0].members).toEqual([0, 1, 2]);
    expect(plan.groups[0].segments).toEqual([{ level: 2, from: 1, to: 2 }]);
  });

  it('gives a lone eighth a flag and no beam', () => {
    const plan = planBeams([on(0, 480), on(960, 960)], 0, FOUR_FOUR);
    expect(plan.groups).toEqual([]);
    expect(plan.flagged).toEqual([0]);
  });

  it('draws no beam or flag for a quarter note or longer', () => {
    const plan = planBeams([on(0, 960), on(960, 1920)], 0, FOUR_FOUR);
    expect(plan.groups).toEqual([]);
    expect(plan.flagged).toEqual([]);
  });

  it('measures beats from the bar start, not tick zero', () => {
    const plan = planBeams([on(3840, 480), on(4320, 480)], 3840, FOUR_FOUR);
    expect(plan.groups.map((g) => g.members)).toEqual([[0, 1]]);
  });

  it('groups six eighths in 6/8 into two groups of three', () => {
    const onsets = [0, 480, 960, 1440, 1920, 2400].map((t) => on(t, 480));
    const plan = planBeams(onsets, 0, SIX_EIGHT);
    expect(plan.groups.map((g) => g.members)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
  });

  it('stubs a lone sixteenth beside a dotted eighth, and breaks the second beam around a plain eighth', () => {
    const stub = planBeams([on(0, 720), on(720, 240)], 0, FOUR_FOUR);
    expect(stub.groups[0].segments).toEqual([{ level: 2, from: 1, to: 1 }]);
    const split = planBeams([on(0, 240), on(240, 480), on(720, 240)], 0, FOUR_FOUR);
    expect(split.groups[0].segments).toEqual([
      { level: 2, from: 0, to: 0 },
      { level: 2, from: 2, to: 2 },
    ]);
  });

  it('adds a third beam over thirty-seconds', () => {
    const plan = planBeams([on(0, 120), on(120, 120), on(240, 120), on(360, 120)], 0, FOUR_FOUR);
    expect(plan.groups[0].segments).toEqual([
      { level: 2, from: 0, to: 3 },
      { level: 3, from: 0, to: 3 },
    ]);
  });

  it('beams eighth triplets as eighths', () => {
    const plan = planBeams([on(0, 320), on(320, 320), on(640, 320)], 0, FOUR_FOUR);
    expect(plan.groups.map((g) => g.members)).toEqual([[0, 1, 2]]);
    expect(plan.groups[0].segments).toEqual([]);
  });

  it('does not let a quarter note join the eighths around it', () => {
    const plan = planBeams([on(0, 480), on(480, 960), on(1440, 480)], 0, FOUR_FOUR);
    expect(plan.groups).toEqual([]);
    expect(plan.flagged).toEqual([0, 2]);
  });
});
