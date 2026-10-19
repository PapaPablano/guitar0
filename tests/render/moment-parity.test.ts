import { describe, expect, it } from 'vitest';
import { renderFretboard } from '../../src/render/fretboard';
import { renderHighway } from '../../src/render/highway';
import { computeLayout } from '../../src/render/layout';
import { momentAt } from '../../src/render/moment';
import { PICK_PROFILE } from '../../src/render/neck-profile';
import { renderNeckFrame, type PhotoContext } from '../../src/render/neck-view';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import type { Timeline } from '../../src/model/score';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { createRecordingContext, type Call } from '../helpers/recording-context';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';

const W = 1200;
const H = 600;

/** A chord, a 50 ms note, a rest, a slide, and a long note with a short one under it. */
const fixture: NoteSpec[] = [
  { start: 1, end: 2, string: 1, fret: 3 },
  { start: 1, end: 2, string: 2, fret: 5 },
  { start: 1, end: 2, string: 3, fret: 7 },
  { start: 3, end: 3.05, string: 4, fret: 9 },
  { start: 4.05, end: 5.05, string: 2, fret: 7, techniques: { slide: 'out-up' } },
  { start: 6, end: 10, string: 6, fret: 2 },
  { start: 7, end: 7.5, string: 5, fret: 4 },
];
const timeline = makeTimeline(fixture, 2, 6);

/** Moments that matter: starts, ends, mid-note, mid-rest, a quick note, a held one. */
const moments = [0.5, 1, 1.5, 1.999, 2, 3.02, 3.1, 3.5, 4.5, 5.04, 5.1, 6.5, 7.2, 7.5, 8];

const halos = (calls: Call[]) => calls.filter((c) => c.name === 'arc' && c.alpha === 0.14).length;

function highwayLit(tl: Timeline, t: number): number {
  const { ctx, calls } = createRecordingContext();
  renderHighway(ctx, tl, 0, t, W, H);
  const layout = computeLayout(W, H, tl.tracks[0].stringCount);
  // a gem sits on the strikeline only while its note sounds, and its fret number is drawn at its centre
  const digits = new Set(tl.notesForTrack(0).map((n) => String(n.fret)));
  return calls.filter((c) => c.name === 'fillText' && digits.has(String(c.args[0])) && Math.abs((c.args[1] as number) - layout.strikeX) < 1e-6).length;
}

function fretboardLit(tl: Timeline, t: number): number {
  const { ctx, calls } = createRecordingContext();
  renderFretboard(ctx, tl, 0, t, W, H, { lookahead: 4 });
  return halos(calls);
}

function neckLit(tl: Timeline, t: number, pick: boolean): number {
  const { ctx, calls } = createRecordingContext();
  renderNeckFrame(ctx as unknown as PhotoContext, null, tl, 0, t, W, H, { zoom: true, lookahead: 4, ...(pick ? { profile: PICK_PROFILE } : {}) });
  return halos(calls);
}

describe('every note-lighting view lights exactly what the moment says is sounding', () => {
  for (const t of moments) {
    it(`at ${t} s`, () => {
      const expected = momentAt(timeline, 0, t).sounding.size;
      expect(highwayLit(timeline, t), 'highway').toBe(expected);
      expect(fretboardLit(timeline, t), 'fretboard').toBe(expected);
      expect(neckLit(timeline, t, false), 'neck').toBe(expected);
      expect(neckLit(timeline, t, true), 'pick').toBe(expected);
    });
  }

  it('lights nothing anywhere mid-rest', () => {
    expect(momentAt(timeline, 0, 3.5).sounding.size).toBe(0);
    expect(highwayLit(timeline, 3.5)).toBe(0);
    expect(fretboardLit(timeline, 3.5)).toBe(0);
    expect(neckLit(timeline, 3.5, false)).toBe(0);
  });

  it('keeps the long note lit in every view while the short one under it starts and ends', () => {
    for (const t of [6.5, 7.2, 8]) {
      const held = t === 7.2 ? 2 : 1;
      expect(momentAt(timeline, 0, t).sounding.size).toBe(held);
      expect(highwayLit(timeline, t)).toBe(held);
      expect(fretboardLit(timeline, t)).toBe(held);
      expect(neckLit(timeline, t, false)).toBe(held);
    }
  });

  it('agrees across a repeat: just before and just after the jump back', () => {
    const repeat = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    for (const t of [5.99, 6.01]) {
      const expected = momentAt(repeat, 0, t).sounding.size;
      expect(fretboardLit(repeat, t)).toBe(expected);
      expect(neckLit(repeat, t, false)).toBe(expected);
    }
  });
});
