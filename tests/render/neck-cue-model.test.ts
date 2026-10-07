import { describe, expect, it } from 'vitest';
import { bendSide, cuesAt, nextOnString, SHIVER_HERTZ } from '../../src/render/neck-cue-model';
import { DEFAULT_LOOKAHEAD } from '../../src/render/fretboard-steps';
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

describe('the finger pose', () => {
  const DEFAULT_LOOK = DEFAULT_LOOKAHEAD;
  const bendOn = (string: number, semitones: number) => notesOf([{ start: 1, end: 2, string, fret: 7, techniques: { bend: semitones } }]);
  const acrossAt = (notes: ReturnType<typeof notesOf>, t: number, count = 6) => cuesAt(notes, t, DEFAULT_LOOK, count).poses.get(notes[0].id)?.across ?? 0;

  it('covers AE1: bends the upper-half strings toward the lower-pitched neighbour and the rest the other way', () => {
    expect(acrossAt(bendOn(2, 2), 1.9)).toBeGreaterThan(0);
    expect(acrossAt(bendOn(3, 2), 1.9)).toBeGreaterThan(0);
    expect(acrossAt(bendOn(1, 2), 1.9)).toBeGreaterThan(0);
    expect(acrossAt(bendOn(4, 2), 1.9)).toBeLessThan(0);
    expect(acrossAt(bendOn(5, 2), 1.9)).toBeLessThan(0);
    expect(acrossAt(bendOn(6, 2), 1.9)).toBeLessThan(0);
  });

  it('keeps the same rule on a four-string bass and a seven-string guitar', () => {
    expect(bendSide(2, 4)).toBe(1);
    expect(bendSide(3, 4)).toBe(-1);
    expect(bendSide(3, 7)).toBe(1);
    expect(bendSide(4, 7)).toBe(-1);
    expect(acrossAt(bendOn(3, 2), 1.9, 4)).toBeLessThan(0);
  });

  it('covers AE3: moves a half-step bend about half as far as a full-step one, and caps beyond two semitones', () => {
    const half = Math.abs(acrossAt(bendOn(2, 1), 1.9));
    const full = Math.abs(acrossAt(bendOn(2, 2), 1.9));
    const more = Math.abs(acrossAt(bendOn(2, 4), 1.9));
    expect(half).toBeGreaterThan(0);
    expect(half / full).toBeCloseTo(0.5, 6);
    expect(more).toBeCloseTo(full, 9);
    expect(full).toBeLessThan(1);
  });

  it('eases in from nothing at the start of the note and is gone once it ends', () => {
    const notes = bendOn(2, 2);
    expect(acrossAt(notes, 1)).toBe(0);
    expect(Math.abs(acrossAt(notes, 1.1))).toBeLessThan(Math.abs(acrossAt(notes, 1.5)));
    expect(acrossAt(notes, 2.1)).toBe(0);
  });

  it('covers AE4: rocks a vibrato note with the shared wave while it sounds, and settles after', () => {
    const notes = notesOf([{ start: 1, end: 3, string: 3, techniques: { vibrato: true } }]);
    const t = 1.5 + 1 / (4 * SHIVER_HERTZ);
    const a = acrossAt(notes, t);
    expect(a).not.toBe(0);
    expect(acrossAt(notes, t + 1 / SHIVER_HERTZ)).toBeCloseTo(a, 6);
    expect(acrossAt(notes, t + 1 / (2 * SHIVER_HERTZ))).toBeCloseTo(-a, 6);
    expect(acrossAt(notes, 3.2)).toBe(0);
  });

  it('covers AE4: carries the ring along a shift slide from the starting fret to the target', () => {
    const notes = notesOf([
      { start: 1, end: 2, string: 4, fret: 5, techniques: { slide: 'shift' } },
      { start: 2, end: 2.5, string: 4, fret: 9 },
    ]);
    const fretAt = (t: number) => cuesAt(notes, t).poses.get(notes[0].id)?.fret ?? notes[0].fret;
    expect(fretAt(1)).toBeCloseTo(5, 9);
    expect(fretAt(1.5)).toBeCloseTo(7, 9);
    expect(fretAt(1.99)).toBeCloseTo(9, 1);
    expect(fretAt(2.1)).toBe(5);
  });

  it('brings a slide into a note from three frets away just before it starts', () => {
    const notes = notesOf([{ start: 1, end: 2, string: 3, fret: 7, techniques: { slide: 'in-below' } }]);
    const pose = (t: number) => cuesAt(notes, t).poses.get(notes[0].id);
    expect(pose(0.875)?.fret).toBeCloseTo(5.5, 9);
    expect(pose(1.5)).toBeUndefined();
  });

  it('taps a hammer-on destination down right after it starts, and not later', () => {
    const notes = notesOf([
      { start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'origin' } },
      { start: 1.5, end: 2, string: 3, fret: 7, techniques: { hammerPull: 'destination' } },
    ]);
    const press = (id: string, t: number) => cuesAt(notes, t).poses.get(id)?.press ?? 1;
    expect(press(notes[1].id, 1.52)).toBeLessThan(1);
    expect(press(notes[1].id, 1.9)).toBe(1);
    expect(press(notes[0].id, 1.2)).toBe(1);
  });

  it('lifts a pull-off origin near its end, and not earlier', () => {
    const notes = notesOf([
      { start: 1, end: 1.5, string: 3, fret: 9, techniques: { hammerPull: 'origin' } },
      { start: 1.5, end: 2, string: 3, fret: 7, techniques: { hammerPull: 'destination' } },
    ]);
    const press = (id: string, t: number) => cuesAt(notes, t).poses.get(id)?.press ?? 1;
    expect(press(notes[0].id, 1.48)).toBeLessThan(1);
    expect(press(notes[0].id, 1.1)).toBe(1);
    expect(press(notes[1].id, 1.52)).toBe(1);
  });

  it('covers AE5: gives a plain note, and any note outside the window, no pose', () => {
    const plain = notesOf([{ start: 1, end: 2 }, { start: 30, end: 31, techniques: { bend: 2 } }]);
    for (const t of [0.5, 1.5, 2.5]) expect(cuesAt(plain, t).poses.size).toBe(0);
  });

  it('draws the same effects, arcs and comets when no string count is given', () => {
    const notes = notesOf([
      { start: 1, end: 2, string: 2, techniques: { bend: 2, vibrato: true } },
      { start: 2, end: 3, string: 4, fret: 5, techniques: { slide: 'shift' } },
      { start: 3, end: 4, string: 4, fret: 9 },
    ]);
    for (const t of [1.5, 2.5]) {
      const a = cuesAt(notes, t);
      const b = cuesAt(notes, t, DEFAULT_LOOK, 6);
      expect(b.effects).toEqual(a.effects);
      expect(b.arcs).toEqual(a.arcs);
      expect(b.comets).toEqual(a.comets);
    }
  });
});

describe('the sounding bends', () => {
  it('lists a bend while it sounds, with its size and side, and nothing before or after', () => {
    const notes = notesOf([{ start: 1, end: 2, string: 2, fret: 7, techniques: { bend: 2 } }]);
    const at = (t: number) => cuesAt(notes, t).bends;
    expect(at(0.5)).toEqual([]);
    expect(at(2.2)).toEqual([]);
    expect(at(1.9)).toHaveLength(1);
    expect(at(1.9)[0]).toMatchObject({ side: 1 });
    expect(at(1.9)[0].note.id).toBe(notes[0].id);
    expect(at(1.9)[0].amount).toBeGreaterThan(0.9);
  });

  it('puts the lowest-pitched bend first when several sound together', () => {
    const notes = notesOf([
      { start: 1, end: 2, string: 2, fret: 7, techniques: { bend: 2 } },
      { start: 1, end: 2, string: 5, fret: 7, techniques: { bend: 1 } },
    ]);
    const bends = cuesAt(notes, 1.9).bends;
    expect(bends.map((b) => b.note.string)).toEqual([5, 2]);
    expect(bends[0].side).toBe(-1);
  });

  it('lists no bend for notes without one', () => {
    expect(cuesAt(notesOf([{ start: 1, end: 2, techniques: { vibrato: true } }]), 1.5).bends).toEqual([]);
  });
});
