import { describe, expect, it } from 'vitest';
import { acceptShift, proposeStartCorrection, shiftTimeline, startCheckApplies, startGuess } from '../../src/alignment/start-check';

describe('startCheckApplies', () => {
  it('covers AE1: applies when bar 1 sits before the recording and both begin sounding at once', () => {
    expect(startCheckApplies(-0.56, 0.1, 0.0, 2.6)).toBe(true);
    expect(startCheckApplies(-0.9, 0.1, 0.1, 2.6)).toBe(true);
  });

  it('covers AE2: does not apply when the recording has a long lead-in', () => {
    expect(startCheckApplies(-0.3, 8, 0, 2.6)).toBe(false);
  });

  it('does not apply when bar 1 is inside the margin or at or after the start of the recording', () => {
    expect(startCheckApplies(-0.1, 0.1, 0, 2.6)).toBe(false);
    expect(startCheckApplies(0, 0.1, 0, 2.6)).toBe(false);
    expect(startCheckApplies(0.5, 0.1, 0, 2.6)).toBe(false);
  });

  it('does not apply when bar 1 is a whole bar or more before the recording, as when the recording really starts later in the song', () => {
    expect(startCheckApplies(-2.6, 0.1, 0, 2.6)).toBe(false);
    expect(startCheckApplies(-5, 0.1, 0, 2.6)).toBe(false);
  });

  it('does not apply when the tab does not begin sounding at its start', () => {
    expect(startCheckApplies(-0.56, 0.1, 2, 2.6)).toBe(false);
  });

  it('does not apply when either side never sounds', () => {
    expect(startCheckApplies(-0.56, null, 0, 2.6)).toBe(false);
    expect(startCheckApplies(-0.56, 0.1, null, 2.6)).toBe(false);
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
    expect(acceptShift(false, 1, 5, 2)).toBe(false);
  });

  it('accepts one that passes when bar 1 is at least as well supported as before', () => {
    expect(acceptShift(true, 2, 2, 5)).toBe(true);
    expect(acceptShift(true, 2, 4, 5)).toBe(true);
  });

  it('accepts one that passes and is convincing on its own even when the old place scored higher', () => {
    expect(acceptShift(true, 6, 3, 2.5)).toBe(true);
  });

  it('rejects one that is weaker than before and not convincing on its own', () => {
    expect(acceptShift(true, 4, 1, 2.5)).toBe(false);
  });
});

describe('proposeStartCorrection', () => {
  const base = {
    anchors: [-0.56, 2, 4.58],
    endAnchor: 7.2,
    barOneStart: 0,
    barSeconds: 2.6,
    recordingFirstSound: 0.1,
    tabFirstSound: 0,
    refine: (guess: number) => ({ seconds: guess, prominence: 3 }),
    passesCheck: () => true,
    floor: 2.5,
  };

  it('covers AE1: moves bar 1 to the first sound and every later bar by the same amount', () => {
    const out = proposeStartCorrection(base)!;
    expect(out.anchors[0]).toBeCloseTo(0.1, 6);
    expect(out.anchors[1] - out.anchors[0]).toBeCloseTo(2.56, 6);
    expect(out.endAnchor).toBeCloseTo(7.86, 6);
  });

  it('uses the onset-refined position when the onsets support one', () => {
    const out = proposeStartCorrection({ ...base, refine: (g) => ({ seconds: g + 0.03, prominence: 4 }) })!;
    expect(out.anchors[0]).toBeCloseTo(0.13, 6);
  });

  it('covers AE2: returns null when the recording has a long lead-in', () => {
    expect(proposeStartCorrection({ ...base, recordingFirstSound: 8 })).toBeNull();
  });

  it('covers AE3: returns null when the shifted timeline fails the check', () => {
    expect(proposeStartCorrection({ ...base, passesCheck: () => false })).toBeNull();
  });
});
