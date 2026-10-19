import { describe, expect, it } from 'vitest';
import { isSounding, momentAt } from '../../src/render/moment';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { makeTimeline } from '../helpers/make-timeline';

const note = (startSeconds: number, endSeconds: number) => ({ startSeconds, endSeconds });

describe('isSounding', () => {
  it('is true from the start up to, but not including, the end', () => {
    expect(isSounding(note(2, 3), 1.999)).toBe(false);
    expect(isSounding(note(2, 3), 2)).toBe(true);
    expect(isSounding(note(2, 3), 2.999)).toBe(true);
    expect(isSounding(note(2, 3), 3)).toBe(false);
  });

  it('never counts a note of no length', () => {
    expect(isSounding(note(2, 2), 2)).toBe(false);
  });
});

describe('momentAt', () => {
  const rest = makeTimeline([
    { start: 0, end: 0.5, string: 1, fret: 3 },
    { start: 1.5, end: 2, string: 2, fret: 5 },
    { start: 3, end: 3.5, string: 3, fret: 7 },
  ]);

  it('has no playing step in the middle of a rest, and the next note is upcoming', () => {
    const m = momentAt(rest, 0, 1, { lookahead: 2 });
    expect(m.sounding.size).toBe(0);
    expect(m.playing).toBeNull();
    expect(m.trail).toEqual([]);
    expect(m.upcoming.map((s) => s.notes[0].fret)).toEqual([5, 7]);
  });

  it('puts every note of a chord in the sounding set and one step in playing', () => {
    const chord = makeTimeline([
      { start: 1, end: 2, string: 1, fret: 3 },
      { start: 1, end: 2, string: 2, fret: 2 },
      { start: 1, end: 2, string: 3, fret: 0 },
    ]);
    const m = momentAt(chord, 0, 1.5);
    expect(m.sounding.size).toBe(3);
    expect(m.playing?.notes).toHaveLength(3);
  });

  it('keeps a long note in the sounding set while a shorter later note starts and ends', () => {
    const held = makeTimeline([
      { start: 0, end: 4, string: 1, fret: 3 },
      { start: 1, end: 1.5, string: 2, fret: 5 },
    ]);
    const long = held.notesForTrack(0)[0];
    const short = held.notesForTrack(0)[1];
    const during = momentAt(held, 0, 1.2);
    expect([...during.sounding].sort()).toEqual([long.id, short.id].sort());
    const after = momentAt(held, 0, 2);
    expect([...after.sounding]).toEqual([long.id]);
    // the short step has ended, so no step is playing, but the held note is still lit
    expect(after.playing).toBeNull();
  });

  it('counts a 50 ms note as sounding only for 50 ms', () => {
    const quick = makeTimeline([{ start: 1, end: 1.05, string: 1, fret: 3 }]);
    expect(momentAt(quick, 0, 1.02).sounding.size).toBe(1);
    expect(momentAt(quick, 0, 1.1).sounding.size).toBe(0);
  });

  it('reports the playback bar on both sides of a repeat jump, and the loop it was given', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const before = momentAt(timeline, 0, 5.99);
    const after = momentAt(timeline, 0, 6.01, { loop: { startBar: 1, endBar: 2 } });
    expect(timeline.bars[before.playbackBar].scoreBar).toBe(2);
    expect(timeline.bars[after.playbackBar].scoreBar).toBe(0);
    expect(after.loop).toEqual({ startBar: 1, endBar: 2 });
    expect(before.loop).toBeNull();
  });

  it('clamps the look-ahead as the fretboard always did', () => {
    expect(momentAt(rest, 0, 0.1, { lookahead: 99 }).lookahead).toBe(8);
    expect(momentAt(rest, 0, 0.1).lookahead).toBe(4);
  });

  it('copes with an empty track', () => {
    const empty = makeTimeline([]);
    const m = momentAt(empty, 0, 1);
    expect(m.sounding.size).toBe(0);
    expect(m.playing).toBeNull();
    expect(m.upcoming).toEqual([]);
  });
});
