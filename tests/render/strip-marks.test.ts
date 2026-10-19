import { describe, expect, it } from 'vitest';
import { LANE_BUDGET, planMarks, type MarkSlot } from '../../src/render/strip-marks';
import { PLAIN } from '../helpers/make-timeline';
import type { NoteEvent, Techniques } from '../../src/model/score';

let id = 0;
const note = (techniques: Partial<Techniques> = {}, string = 2, fret = 12): NoteEvent => ({
  id: `n${id++}`,
  trackIndex: 0,
  string,
  fret,
  tick: 0,
  durationTicks: 120,
  startSeconds: 0,
  endSeconds: 0.125,
  playbackBar: 0,
  scoreBar: 0,
  techniques: { ...PLAIN, ...techniques },
});

/** Slots `step` apart, one note each. */
const slots = (techs: Partial<Techniques>[], step = 30): MarkSlot[] =>
  techs.map((t, i) => ({ offset: 16 + i * step, notes: [note(t)] }));

describe('planMarks', () => {
  it('returns no marks for a bar of plain notes', () => {
    const plan = planMarks(slots([{}, {}, {}]));
    expect(plan.marks).toEqual([]);
    expect(plan.overflow).toBeUndefined();
  });

  it('puts a bend and a palm-mute run that overlap in different lanes', () => {
    const plan = planMarks(slots([{ bend: 2 }, { palmMute: true }, { palmMute: true }]));
    const bend = plan.marks.find((m) => m.kind === 'bend');
    const pm = plan.marks.find((m) => m.kind === 'palmMute');
    expect(bend?.text).toBe('full');
    expect(pm?.text).toBe('P.M.');
    expect(new Set([bend?.lane, pm?.lane]).size).toBe(2);
  });

  it('keeps marks that do not overlap together in the lowest lane', () => {
    const plan = planMarks(slots([{ harmonic: true }, {}, {}, {}, { harmonic: true }], 60));
    expect(plan.marks.map((m) => m.lane)).toEqual([0, 0]);
  });

  it('treats marks closer than the clearance as overlapping', () => {
    const near = planMarks(slots([{ harmonic: true }, { harmonic: true }], 36));
    const far = planMarks(slots([{ harmonic: true }, { harmonic: true }], 60));
    expect(near.marks.map((m) => m.lane)).toEqual([0, 1]);
    expect(far.marks.map((m) => m.lane)).toEqual([0, 0]);
  });

  it('gives one mark per palm-muted run, spanning the run', () => {
    const plan = planMarks(slots([{ palmMute: true }, { palmMute: true }, {}, { palmMute: true }]));
    const pms = plan.marks.filter((m) => m.kind === 'palmMute');
    expect(pms).toHaveLength(2);
    expect(pms[0].lastSlot).toBe(1);
    expect(pms[1].slot).toBe(3);
  });

  it('uses a lane for every simultaneous mark up to the budget, then reports where to widen', () => {
    const crowded: MarkSlot[] = [
      { offset: 16, notes: [note({ bend: 2 }, 1), note({ harmonic: true }, 2), note({ palmMute: true }, 3)] },
      { offset: 46, notes: [note({ bend: 2 }, 1)] },
    ];
    const plan = planMarks(crowded);
    expect(Math.max(...plan.marks.map((m) => m.lane))).toBeGreaterThanOrEqual(LANE_BUDGET);
    expect(plan.overflow).toBeDefined();
    expect(plan.overflow?.slot).toBeLessThanOrEqual(1);
    expect(plan.overflow?.shortfall).toBeGreaterThan(0);
  });

  it('starts a bend arrow clear of a number stacked above it in the same slot', () => {
    const chord: MarkSlot[] = [{ offset: 16, notes: [note({}, 1, 15), note({ bend: 2 }, 2, 15)] }];
    const alone: MarkSlot[] = [{ offset: 16, notes: [note({ bend: 2 }, 2, 15)] }];
    const withAbove = planMarks(chord).marks[0];
    const without = planMarks(alone).marks[0];
    expect(withAbove.arrowOffset).toBeGreaterThan(without.arrowOffset);
  });
});
