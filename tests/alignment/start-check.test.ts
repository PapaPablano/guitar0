import { describe, expect, it } from 'vitest';
import { acceptShift, shiftTimeline, startCheckApplies, startGuess } from '../../src/alignment/start-check';

describe('startCheckApplies', () => {
  it('covers AE1: applies when bar 1 sits before the recording and both begin sounding at once', () => {
    expect(startCheckApplies(-0.56, 0.1, 0.0)).toBe(true);
    expect(startCheckApplies(-0.9, 0.1, 0.1)).toBe(true);
  });

  it('covers AE2: does not apply when the recording has a long lead-in', () => {
    expect(startCheckApplies(-0.3, 8, 0)).toBe(false);
  });

  it('does not apply when bar 1 is inside the margin or at or after the start of the recording', () => {
    expect(startCheckApplies(-0.1, 0.1, 0)).toBe(false);
    expect(startCheckApplies(0, 0.1, 0)).toBe(false);
    expect(startCheckApplies(0.5, 0.1, 0)).toBe(false);
  });

  it('does not apply when the tab does not begin sounding at its start', () => {
    expect(startCheckApplies(-0.56, 0.1, 2)).toBe(false);
  });

  it('does not apply when either side never sounds', () => {
    expect(startCheckApplies(-0.56, null, 0)).toBe(false);
    expect(startCheckApplies(-0.56, 0.1, null)).toBe(false);
  });
});

describe('startGuess', () => {
  it('puts bar 1 where the recording first sounds, less how long the tab takes to sound after its own bar 1', () => {
    expect(startGuess(0, 0.09, 0.02)).toBeCloseTo(0.07, 6);
    expect(startGuess(1, 0.5, 0.2)).toBeCloseTo(1.3, 6);
  });
});

describe('shiftTimeline', () => {
  it('moves every anchor and the end anchor by one constant, keeping all spacings', () => {
    const out = shiftTimeline([-0.56, 2, 4.58], 7.2, 0.65);
    expect(out.anchors).toEqual([0.09, 2.65, 5.23].map((v) => expect.closeTo(v, 6)));
    expect(out.endAnchor).toBeCloseTo(7.85, 6);
    expect(out.anchors[1] - out.anchors[0]).toBeCloseTo(2.56, 6);
  });
});

describe('acceptShift', () => {
  it('covers AE3: rejects a shifted timeline that fails the check', () => {
    expect(acceptShift(false, 1, 5)).toBe(false);
  });

  it('accepts one that passes when bar 1 is at least as well supported as before', () => {
    expect(acceptShift(true, 2, 2)).toBe(true);
    expect(acceptShift(true, 2, 4)).toBe(true);
  });

  it('rejects one whose bar 1 is less well supported than before', () => {
    expect(acceptShift(true, 4, 2)).toBe(false);
  });
});
