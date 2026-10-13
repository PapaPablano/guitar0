import { describe, expect, it, vi } from 'vitest';
import { commitCalibration, DEFAULT_FRETS, flowReducer, initialFlow, type FlowAction, type FlowState } from '../../src/app/neck-calibration-flow';
import { makeSampleTimeline } from '../../src/app/neck-calibration-sample';
import type { Point } from '../../src/render/neck-calibration';
import { pickPlan } from '../../src/render/pick-cues';

/** A level 22-fret neck in a 2200 by 1000 photo: nut, 12th and last fret at the high-e and low-E strings, then the pick point. */
const sh = (n: number) => 1 - Math.pow(2, -n / 12);
const wire = (n: number) => 200 + (2400 * sh(n)) / (1 + 0.5 * sh(n));
const top = (x: number) => 300 + 0.03 * (x - 200);
const bottom = (x: number) => 420 - 0.03 * (x - 200);
const GOOD: Point[] = [
  { x: 200, y: top(200) },
  { x: 200, y: bottom(200) },
  { x: wire(12), y: top(wire(12)) },
  { x: wire(12), y: bottom(wire(12)) },
  { x: wire(22), y: top(wire(22)) },
  { x: wire(22), y: bottom(wire(22)) },
  { x: wire(22) + 120, y: 360 },
];

const run = (actions: FlowAction[], from: FlowState = initialFlow) => actions.reduce(flowReducer, from);
const chosen = (): FlowAction => ({ type: 'photo', width: 2200, height: 1000 });
const taps = (points: Point[]): FlowAction[] => points.map((point) => ({ type: 'tap', point }));

describe('the calibration flow', () => {
  it('starts by choosing a photo', () => {
    expect(initialFlow.step).toBe('choosing');
  });

  it('covers AE8: seven taps and a fret count lead to the preview with a fitted profile', () => {
    const s = run([chosen(), { type: 'fretCount', count: 22 }, ...taps(GOOD)]);
    expect(s.step).toBe('preview');
    if (s.step === 'preview') {
      expect(s.result.profile.fretX).toHaveLength(22);
      expect(s.result.profile.pickX).toBeGreaterThan(s.result.profile.fretX[21]);
    }
  });

  it('stays on tapping until the seventh tap, one prompt at a time', () => {
    let s = run([chosen()]);
    for (let i = 0; i < 6; i++) {
      s = flowReducer(s, { type: 'tap', point: GOOD[i] });
      expect(s.step).toBe('tapping');
      if (s.step === 'tapping') expect(s.taps).toHaveLength(i + 1);
    }
  });

  it('covers AE9: Redo from the preview restarts the seven taps from the first, on the same photo', () => {
    const s = run([chosen(), ...taps(GOOD), { type: 'redo' }]);
    expect(s.step).toBe('tapping');
    if (s.step === 'tapping') {
      expect(s.taps).toHaveLength(0);
      expect(s.photo).toEqual({ width: 2200, height: 1000 });
    }
  });

  it('covers AE9: a calibration abandoned after three taps has saved nothing', async () => {
    const save = vi.fn();
    const s = run([chosen(), ...taps(GOOD.slice(0, 3))]);
    expect(s.step).toBe('tapping');
    await expect(commitCalibration(s, new Blob(['x']), { save } as never)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  it('covers AE14: a photo that cannot be decoded keeps the choosing step with a message', () => {
    const s = run([{ type: 'photoFailed', message: 'That photo could not be read.' }]);
    expect(s).toEqual({ step: 'choosing', message: 'That photo could not be read.' });
  });

  it('returns to tapping with the reason, and no taps kept, when the taps cannot be a neck', () => {
    const bad = [...GOOD];
    bad[6] = GOOD[2];
    const s = run([chosen(), ...taps(bad)]);
    expect(s.step).toBe('tapping');
    if (s.step === 'tapping') {
      expect(s.taps).toHaveLength(0);
      expect(s.message).toMatch(/pick/i);
    }
  });

  it('refits when the fret count changes in the preview', () => {
    const s = run([chosen(), ...taps(GOOD)]);
    const next = flowReducer(s, { type: 'fretCount', count: 24 });
    expect(next.step).toBe('preview');
    if (next.step === 'preview') expect(next.result.profile.fretX).toHaveLength(24);
  });

  it('starts at 22 frets', () => {
    const s = run([chosen()]);
    if (s.step === 'tapping') expect(s.fretCount).toBe(DEFAULT_FRETS);
  });

  it('covers AE8: Done saves the photo and the fitted profile', async () => {
    const save = vi.fn(async () => undefined);
    const s = run([chosen(), ...taps(GOOD)]);
    const photo = new Blob(['turned']);
    await commitCalibration(s, photo, { save } as never);
    expect(save).toHaveBeenCalledTimes(1);
    const [blob, profile] = save.mock.calls[0] as unknown as [Blob, { fretX: number[] }];
    expect(blob).toBe(photo);
    expect(profile.fretX).toHaveLength(22);
  });
});

describe('the preview sample', () => {
  const timeline = makeSampleTimeline();
  const notes = timeline.notesForTrack(0);

  it('is a short loop with a chord, single notes and a hammer-on, so every effect shows', () => {
    expect(timeline.durationSeconds).toBeGreaterThan(2);
    expect(new Set(notes.map((n) => n.startSeconds)).size).toBeLessThan(notes.length);
    expect(notes.some((n) => n.techniques.hammerPull === 'destination')).toBe(true);
    expect(notes.every((n) => n.endSeconds <= timeline.durationSeconds)).toBe(true);
  });

  it('has both down and up strokes picked', () => {
    const strokes = new Set(pickPlan(notes).steps.map((s) => s.stroke));
    expect(strokes).toEqual(new Set(['down', 'up']));
  });
});
