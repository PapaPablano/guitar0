import { describe, expect, it } from 'vitest';
import { clampLookahead, groupSteps, maxFretUsed, stepsAt, TRAIL_STEPS } from '../../src/render/fretboard-steps';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { makeTimeline } from '../helpers/make-timeline';

const line = makeTimeline([
  { start: 0, end: 0.5, string: 1, fret: 3 },
  { start: 1, end: 1.5, string: 2, fret: 5 },
  { start: 2, end: 2.5, string: 3, fret: 7 },
  { start: 3, end: 3.5, string: 4, fret: 9 },
  { start: 4, end: 4.5, string: 5, fret: 12 },
  { start: 5, end: 5.5, string: 6, fret: 0 },
]).notesForTrack(0);

describe('groupSteps', () => {
  it('makes a chord on three strings one step', () => {
    const chord = makeTimeline([
      { start: 1, end: 2, string: 1, fret: 3 },
      { start: 1, end: 2, string: 2, fret: 2 },
      { start: 1, end: 2, string: 3, fret: 0 },
      { start: 2, end: 3, string: 1, fret: 5 },
    ]).notesForTrack(0);
    const steps = groupSteps(chord);
    expect(steps).toHaveLength(2);
    expect(steps[0].notes).toHaveLength(3);
  });

  it('returns the same grouping for the same notes (cached)', () => {
    expect(groupSteps(line)).toBe(groupSteps(line));
  });
});

describe('stepsAt', () => {
  it('shows the playing step, the next steps in order and the trail', () => {
    const at = stepsAt(line, 2.2, 2);
    expect(at.playing?.notes[0].fret).toBe(7);
    expect(at.upcoming.map((s) => s.notes[0].fret)).toEqual([9, 12]);
    expect(at.trail.map((s) => s.notes[0].fret)).toEqual([5, 3]);
  });

  it('keeps the playing step until the next one starts, through a rest', () => {
    expect(stepsAt(line, 2.9, 1).playing?.notes[0].fret).toBe(7);
    expect(stepsAt(line, 3, 1).playing?.notes[0].fret).toBe(9);
  });

  it('returns one upcoming step for a look-ahead of 1 and up to eight for 8', () => {
    expect(stepsAt(line, 0.1, 1).upcoming).toHaveLength(1);
    expect(stepsAt(line, 0.1, 8).upcoming).toHaveLength(5); // only five steps remain
  });

  it('has nothing playing before the first note, and upcoming starts at the first note', () => {
    const early = makeTimeline([
      { start: 1, end: 1.5, fret: 4 },
      { start: 2, end: 2.5, fret: 6 },
    ]).notesForTrack(0);
    const at = stepsAt(early, 0.2, 2);
    expect(at.playing).toBeNull();
    expect(at.upcoming.map((s) => s.notes[0].fret)).toEqual([4, 6]);
    expect(at.trail).toEqual([]);
  });

  it('has no upcoming steps after the last note, and the trail still shows earlier notes', () => {
    const at = stepsAt(line, 9, 4);
    expect(at.playing?.notes[0].fret).toBe(0);
    expect(at.upcoming).toEqual([]);
    expect(at.trail).toHaveLength(TRAIL_STEPS);
  });

  it('treats a newer step as playing while an earlier note still sustains', () => {
    const sustained = makeTimeline([
      { start: 0, end: 4, string: 1, fret: 3 },
      { start: 1, end: 1.5, string: 2, fret: 5 },
    ]).notesForTrack(0);
    const at = stepsAt(sustained, 1.2, 2);
    expect(at.playing?.notes[0].fret).toBe(5);
    expect(at.trail.map((s) => s.notes[0].fret)).toEqual([3]);
  });

  it('follows playback order across a repeat', () => {
    // bars 0-2 play twice; after the end of bar 2 the next step is the first note of bar 0 again
    const notes = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO)).notesForTrack(0);
    const endOfBar2 = 5.6; // last beat of the first pass through bar 2 (bars are 2 s at 120 bpm)
    const at = stepsAt(notes, endOfBar2, 1);
    expect(at.playing?.notes[0].scoreBar).toBe(2);
    expect(at.upcoming[0].notes[0].scoreBar).toBe(0);
    expect(at.upcoming[0].notes[0].playbackBar).toBe(3);
  });

  it('copes with an empty track', () => {
    const at = stepsAt([], 1, 4);
    expect(at).toEqual({ playing: null, upcoming: [], trail: [] });
  });
});

describe('clampLookahead', () => {
  it('keeps values between 1 and 8, rounds, and falls back to 4', () => {
    expect([clampLookahead(0), clampLookahead(1), clampLookahead(8), clampLookahead(99)]).toEqual([1, 1, 8, 8]);
    expect(clampLookahead(3.6)).toBe(4);
    expect(clampLookahead('5')).toBe(5);
    expect(clampLookahead('')).toBe(1); // Number('') is 0, which clamps up to 1
    expect(clampLookahead(undefined)).toBe(4);
    expect(clampLookahead(NaN)).toBe(4);
  });
});

describe('maxFretUsed', () => {
  it('returns the highest fret, or 0 for no notes', () => {
    expect(maxFretUsed(line)).toBe(12);
    expect(maxFretUsed([])).toBe(0);
  });
});
