import { describe, expect, it } from 'vitest';
import { cuesAt, nextOnString } from '../../src/render/neck-cue-model';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';

const notesOf = (specs: NoteSpec[]) => makeTimeline(specs).notesForTrack(0);

describe('hammer-ons and pull-offs', () => {
  it('covers AE1: join the origin to the next note on its string, and mark that note as not picked', () => {
    const notes = notesOf([
      { start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'origin' } },
      { start: 1.5, end: 2, string: 3, fret: 7, techniques: { hammerPull: 'destination' } },
    ]);
    const cues = cuesAt(notes, 1.2);
    expect(cues.arcs).toHaveLength(1);
    expect(cues.arcs[0].from.fret).toBe(5);
    expect(cues.arcs[0].to.fret).toBe(7);
    expect(cues.unpicked.has(notes[1].id)).toBe(true);
    expect(cues.unpicked.has(notes[0].id)).toBe(false);
  });

  it('joins a pull-off down the neck the same way, skipping notes on other strings', () => {
    const notes = notesOf([
      { start: 1, end: 1.5, string: 2, fret: 9, techniques: { hammerPull: 'origin' } },
      { start: 1.25, end: 1.5, string: 5, fret: 3 },
      { start: 1.5, end: 2, string: 2, fret: 7, techniques: { hammerPull: 'destination' } },
    ]);
    const arc = cuesAt(notes, 1.1).arcs[0];
    expect(arc.to.string).toBe(2);
    expect(arc.to.fret).toBe(7);
  });

  it('joins nothing when no later note follows on the string', () => {
    const notes = notesOf([{ start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'origin' } }]);
    expect(cuesAt(notes, 1.2).arcs).toEqual([]);
  });
});

describe('slides', () => {
  const slide = () => notesOf([
    { start: 1, end: 2, string: 4, fret: 5, techniques: { slide: 'shift' } },
    { start: 2, end: 2.5, string: 4, fret: 9 },
  ]);

  it('covers AE2: a comet whose head starts at the starting fret, is halfway at the middle of the note, and reaches the ending fret at its end', () => {
    const notes = slide();
    const at = (t: number) => cuesAt(notes, t).comets[0];
    expect(at(1).head).toBeCloseTo(0, 9);
    expect(at(1.5).head).toBeCloseTo(0.5, 9);
    expect(at(2).head).toBeCloseTo(1, 9);
    expect(at(1.5)).toMatchObject({ fromFret: 5, toFret: 9, kind: 'between', strength: 1 });
  });

  it('lets the comet fade after the note instead of vanishing, and is gone after that', () => {
    const notes = slide();
    expect(cuesAt(notes, 2.1).comets[0].strength).toBeCloseTo(0.5, 9);
    expect(cuesAt(notes, 2.3).comets).toEqual([]);
  });

  it('draws no comet before the slide starts', () => {
    expect(cuesAt(slide(), 0.9).comets).toEqual([]);
  });

  it('leaves a short comet out of a note on the side the slide goes: downward toward lower frets, upward toward higher', () => {
    const down = cuesAt(notesOf([{ start: 1, end: 2, fret: 12, techniques: { slide: 'out-down' } }]), 1.5).comets[0];
    const up = cuesAt(notesOf([{ start: 1, end: 2, fret: 12, techniques: { slide: 'out-up' } }]), 1.5).comets[0];
    expect(down).toMatchObject({ kind: 'out', fromFret: 12, toFret: 9 });
    expect(up).toMatchObject({ kind: 'out', fromFret: 12, toFret: 15 });
  });

  it('arrives from below or above for a slide into a note, just before it starts', () => {
    const below = notesOf([{ start: 1, end: 2, fret: 7, techniques: { slide: 'in-below' } }]);
    const above = notesOf([{ start: 1, end: 2, fret: 7, techniques: { slide: 'in-above' } }]);
    expect(cuesAt(below, 0.875).comets[0]).toMatchObject({ kind: 'in', fromFret: 4, toFret: 7 });
    expect(cuesAt(below, 0.875).comets[0].head).toBeCloseTo(0.5, 9);
    expect(cuesAt(above, 0.9).comets[0]).toMatchObject({ fromFret: 10, toFret: 7 });
    expect(cuesAt(below, 0.5).comets).toEqual([]);
  });

  it('keeps a short slide out of the first fret on the board', () => {
    const near = cuesAt(notesOf([{ start: 1, end: 2, fret: 2, techniques: { slide: 'out-down' } }]), 1.5).comets[0];
    expect(near.toFret).toBe(0);
  });
});

describe('bend, vibrato and palm mute', () => {
  const bend = (semitones: number) => notesOf([{ start: 1, end: 2, techniques: { bend: semitones } }]);

  it('covers AE3: a full bend deflects twice as much as a half-step bend, and more than two semitones is capped', () => {
    const half = cuesAt(bend(1), 1.9).effects.values().next().value!.bend;
    const full = cuesAt(bend(2), 1.9).effects.values().next().value!.bend;
    const more = cuesAt(bend(4), 1.9).effects.values().next().value!.bend;
    expect(full).toBeCloseTo(2 * half, 9);
    expect(more).toBe(full);
    expect(full).toBeCloseTo(1, 9);
  });

  it('eases the bend in over the start of the note and is gone once it ends', () => {
    const notes = bend(2);
    const at = (t: number) => cuesAt(notes, t).effects.get(notes[0].id)?.bend ?? 0;
    expect(at(1)).toBe(0);
    expect(at(1.1)).toBeGreaterThan(0);
    expect(at(1.1)).toBeLessThan(at(1.3));
    expect(at(1.5)).toBeCloseTo(1, 9);
    expect(cuesAt(notes, 2.1).effects.size).toBe(0);
  });

  it('shivers a vibrato note while it sounds and settles after', () => {
    const notes = notesOf([{ start: 1, end: 2, techniques: { vibrato: true } }]);
    expect(cuesAt(notes, 1.5).effects.get(notes[0].id)?.shiver).toBe(1);
    expect(cuesAt(notes, 0.9).effects.has(notes[0].id)).toBe(false);
    expect(cuesAt(notes, 2.2).effects.has(notes[0].id)).toBe(false);
  });

  it('covers AE4: marks a palm-muted note as muted, before it sounds and while it does', () => {
    const notes = notesOf([{ start: 1, end: 2, techniques: { palmMute: true } }]);
    expect(cuesAt(notes, 0.8).effects.get(notes[0].id)?.muted).toBe(true);
    expect(cuesAt(notes, 1.5).effects.get(notes[0].id)?.muted).toBe(true);
  });

  it('lists harmonics', () => {
    const notes = notesOf([{ start: 1, end: 2, fret: 12, techniques: { harmonic: true } }, { start: 2, end: 3 }]);
    expect(cuesAt(notes, 1.5).harmonics.map((n) => n.fret)).toEqual([12]);
  });

  it('ignores techniques the cues do not cover', () => {
    const notes = notesOf([{ start: 1, end: 2, techniques: { dead: true, ghost: true, letRing: true, tied: true } }]);
    const cues = cuesAt(notes, 1.5);
    expect(cues.arcs).toEqual([]);
    expect(cues.comets).toEqual([]);
    expect(cues.effects.size).toBe(0);
    expect(cues.harmonics).toEqual([]);
    expect(cues.unpicked.size).toBe(0);
  });
});

describe('the pulse', () => {
  it('covers AE5: leaves the playing ring when its note starts and arrives on the next ring when the next note starts', () => {
    const notes = notesOf([
      { start: 1, end: 2, string: 2, fret: 3 },
      { start: 3, end: 4, string: 4, fret: 7 },
    ]);
    const pulse = (t: number) => cuesAt(notes, t).pulse;
    expect(pulse(1)?.progress).toBeCloseTo(0, 9);
    expect(pulse(2)?.progress).toBeCloseTo(0.5, 9);
    expect(pulse(2.999)?.progress).toBeGreaterThan(0.99);
    expect(pulse(2)?.from.fret).toBe(3);
    expect(pulse(2)?.to.fret).toBe(7);
    expect(pulse(1.5)!.progress).toBeLessThan(pulse(2.5)!.progress);
  });

  it('has none when the next note is at the same position', () => {
    const notes = notesOf([
      { start: 1, end: 2, string: 2, fret: 3 },
      { start: 2, end: 3, string: 2, fret: 3 },
    ]);
    expect(cuesAt(notes, 1.5).pulse).toBeNull();
  });

  it('has none after the last step or before the first note', () => {
    const notes = notesOf([{ start: 1, end: 2 }, { start: 2, end: 3, fret: 7 }]);
    expect(cuesAt(notes, 2.5).pulse).toBeNull();
    expect(cuesAt(notes, 0.5).pulse).toBeNull();
  });

  it('follows the lowest-pitched note of a chord', () => {
    const notes = notesOf([
      { start: 1, end: 2, string: 2, fret: 5 },
      { start: 1, end: 2, string: 4, fret: 7 },
      { start: 2, end: 3, string: 5, fret: 3 },
      { start: 2, end: 3, string: 1, fret: 9 },
    ]);
    const pulse = cuesAt(notes, 1.5).pulse!;
    expect(pulse.from.string).toBe(4);
    expect(pulse.to.string).toBe(5);
  });
});

describe('cuesAt', () => {
  it('gives no cues for plain notes, and the same cues for the same notes and time', () => {
    const notes = notesOf([{ start: 1, end: 2 }, { start: 2, end: 3 }]);
    const cues = cuesAt(notes, 1.5);
    expect(cues.arcs).toEqual([]);
    expect(cues.comets).toEqual([]);
    expect(cues.effects.size).toBe(0);
    expect(cuesAt(notes, 1.5)).toEqual(cues);
  });

  it('gives nothing for an empty track', () => {
    expect(cuesAt([], 3).pulse).toBeNull();
    expect(cuesAt([], 3).arcs).toEqual([]);
  });

  it('looks only at the steps the neck view shows', () => {
    const specs: NoteSpec[] = Array.from({ length: 20 }, (_, i) => ({ start: 1 + i, end: 1.5 + i, fret: 3, techniques: { palmMute: true } }));
    const notes = notesOf(specs);
    expect(cuesAt(notes, 1.2, 2).effects.size).toBeLessThanOrEqual(1 + 2);
    expect(cuesAt(notes, 1.2, 8).effects.size).toBeGreaterThan(cuesAt(notes, 1.2, 2).effects.size);
  });
});

describe('nextOnString', () => {
  it('finds the next later note on the same string, or none', () => {
    const notes = notesOf([
      { start: 1, end: 2, string: 3 },
      { start: 1.5, end: 2, string: 4 },
      { start: 2, end: 3, string: 3, fret: 9 },
    ]);
    expect(nextOnString(notes, notes[0])?.fret).toBe(9);
    expect(nextOnString(notes, notes[2])).toBeUndefined();
  });
});
