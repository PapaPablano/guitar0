import { describe, expect, it } from 'vitest';
import {
  PHOTO_FRET_COUNT,
  photoNoteX,
  photoPlacement,
  photoRingRadius,
  photoStringY,
  photoToScreen,
  renderNeckView,
} from '../../src/render/neck-view';
import { emphasisAt } from '../../src/render/emphasis';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';

function draw(specs: NoteSpec[], t: number, w: number, h: number, lookahead?: number) {
  const { ctx, calls } = createRecordingContext();
  renderNeckView(ctx, makeTimeline(specs), 0, t, w, h, { lookahead });
  return calls;
}

describe('photo geometry', () => {
  it('has 24 frets, whose rings move toward the bridge as the fret number rises', () => {
    expect(PHOTO_FRET_COUNT).toBe(24);
    for (let f = 1; f < 24; f++) expect(photoNoteX(f + 1)).toBeGreaterThan(photoNoteX(f));
    expect(photoNoteX(0)).toBeLessThan(photoNoteX(1));
  });

  it('keeps a fret beyond the last on the last fret', () => {
    expect(photoNoteX(30)).toBe(photoNoteX(24));
  });

  it('runs the strings top to bottom, high e first, spreading toward the bridge', () => {
    for (let s = 1; s < 6; s++) expect(photoStringY(s, 6, 300)).toBeLessThan(photoStringY(s + 1, 6, 300));
    const nut = photoStringY(6, 6, 145) - photoStringY(1, 6, 145);
    const far = photoStringY(6, 6, 800) - photoStringY(1, 6, 800);
    expect(far).toBeGreaterThan(nut);
  });

  it('spreads a four-string bass across the same span as six strings', () => {
    expect(photoStringY(1, 4, 400)).toBeCloseTo(photoStringY(1, 6, 400), 6);
    expect(photoStringY(4, 4, 400)).toBeCloseTo(photoStringY(6, 6, 400), 6);
  });

  it('makes rings smaller where the frets are tighter', () => {
    expect(photoRingRadius(20)).toBeLessThan(photoRingRadius(2));
  });
});

describe('photo placement', () => {
  it('lays the photo along the width on a wide screen and turns it upright on a tall one', () => {
    const wide = photoPlacement(1920, 1080);
    const tall = photoPlacement(540, 1170);
    expect(wide.rotated).toBe(false);
    expect(tall.rotated).toBe(true);
    const a = photoToScreen(wide, 181, 230);
    const b = photoToScreen(wide, 804, 230);
    expect(b.x).toBeGreaterThan(a.x);
    const c = photoToScreen(tall, 181, 230);
    const d = photoToScreen(tall, 804, 230);
    expect(d.y).toBeGreaterThan(c.y);
  });

  it('puts the high e on the right when upright', () => {
    const tall = photoPlacement(540, 1170);
    expect(photoToScreen(tall, 300, photoStringY(1, 6, 300)).x).toBeGreaterThan(photoToScreen(tall, 300, photoStringY(6, 6, 300)).x);
  });

  it('covers the whole screen with the photo', () => {
    for (const [w, h] of [[1920, 1080], [2400, 1080], [1000, 800], [540, 1170], [800, 1000]]) {
      const p = photoPlacement(w, h);
      const corners = [[0, 0], [1120, 0], [0, 491], [1120, 491]].map(([x, y]) => photoToScreen(p, x, y));
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      expect(Math.min(...xs)).toBeLessThanOrEqual(0.001);
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(w - 0.001);
      expect(Math.min(...ys)).toBeLessThanOrEqual(0.001);
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(h - 0.001);
    }
  });
});

describe('renderNeckView', () => {
  const specs: NoteSpec[] = [{ start: 1, end: 2, string: 3, fret: 5 }, { start: 3, end: 4, string: 2, fret: 7 }];
  const W = 1920;
  const H = 1080;

  it('draws the playing note as a ring on its string and fret of the photo', () => {
    const place = photoPlacement(W, H);
    const radius = photoRingRadius(5) * place.scale * emphasisAt(1, 2, 1.2).scale;
    const ring = draw(specs, 1.2, W, H).find((c) => c.name === 'arc' && Math.abs((c.args[2] as number) - radius) < 1e-9);
    expect(ring).toBeDefined();
    const at = photoToScreen(place, photoNoteX(5), photoStringY(3, 6, photoNoteX(5)));
    expect(ring?.args[0]).toBeCloseTo(at.x, 6);
    expect(ring?.args[1]).toBeCloseTo(at.y, 6);
  });

  it('labels the ring with the fret number', () => {
    expect(draw(specs, 1.2, W, H).filter((c) => c.name === 'fillText').map((c) => c.args[0])).toContain('5');
  });

  it('lights the string toward the bridge', () => {
    const calls = draw(specs, 1.2, W, H);
    expect(calls.filter((c) => c.name === 'lineTo').length).toBeGreaterThan(3);
  });

  it('draws only the veil for a track with no notes', () => {
    expect(draw([], 1, W, H).filter((c) => c.name === 'arc')).toHaveLength(0);
  });

  it('draws the same calls twice for the same time', () => {
    expect(draw(specs, 1.2, 540, 1170)).toEqual(draw(specs, 1.2, 540, 1170));
  });
});
