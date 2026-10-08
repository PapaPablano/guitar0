import { describe, expect, it } from 'vitest';
import {
  drawNeckPhoto,
  PHOTO_FRET_COUNT,
  PHOTO_HEIGHT,
  PHOTO_WIDTH,
  photoNoteX,
  photoPlacement,
  photoRingRadius,
  photoStringY,
  photoToScreen,
  renderNeckFrame,
  renderNeckView,
  CAMERA_MOVE_MIN,
  zoomedPlacement,
  ZOOM_SPAN,
  type PhotoContext,
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
  it('has 23 frets, whose rings move toward the bridge as the fret number rises', () => {
    expect(PHOTO_FRET_COUNT).toBe(23);
    for (let f = 1; f < PHOTO_FRET_COUNT; f++) expect(photoNoteX(f + 1)).toBeGreaterThan(photoNoteX(f));
    expect(photoNoteX(0)).toBeLessThan(photoNoteX(1));
  });

  it('keeps a fret beyond the last on the last fret', () => {
    expect(photoNoteX(30)).toBe(photoNoteX(PHOTO_FRET_COUNT));
  });

  it('runs the strings top to bottom, high e first, spreading toward the bridge', () => {
    for (let s = 1; s < 6; s++) expect(photoStringY(s, 6, 300)).toBeLessThan(photoStringY(s + 1, 6, 300));
    const nut = photoStringY(6, 6, 140) - photoStringY(1, 6, 140);
    const far = photoStringY(6, 6, 810) - photoStringY(1, 6, 810);
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

describe('the photo and the whole frame', () => {
  const image = {} as CanvasImageSource;
  const specs: NoteSpec[] = [{ start: 1, end: 2, string: 3, fret: 5 }];
  const frame = (w: number, h: number, photo: CanvasImageSource | null = image) => {
    const { ctx, calls } = createRecordingContext();
    renderNeckFrame(ctx as PhotoContext, photo, makeTimeline(specs), 0, 1.2, w, h);
    return calls;
  };

  it('draws the photo first, centred and scaled to the placement, then the rings', () => {
    const calls = frame(1920, 1080);
    const place = photoPlacement(1920, 1080);
    const drawn = calls.findIndex((c) => c.name === 'drawImage');
    expect(drawn).toBeGreaterThanOrEqual(0);
    expect(calls[drawn].args).toEqual([image, -place.centreX, -place.centreY, PHOTO_WIDTH, PHOTO_HEIGHT]);
    expect(calls.findIndex((c) => c.name === 'arc')).toBeGreaterThan(drawn);
    expect(calls.some((c) => c.name === 'rotate')).toBe(false);
  });

  it('turns the photo upright for a tall frame', () => {
    expect(frame(1080, 1920).some((c) => c.name === 'rotate' && c.args[0] === Math.PI / 2)).toBe(true);
  });

  it('draws a plain dark frame, with the rings, before the photo has loaded', () => {
    const calls = frame(1920, 1080, null);
    expect(calls.some((c) => c.name === 'drawImage')).toBe(false);
    expect(calls.some((c) => c.name === 'arc')).toBe(true);
  });

  it('draws the same frame twice', () => {
    expect(frame(1080, 1920)).toEqual(frame(1080, 1920));
  });

  it('can be drawn straight onto a canvas surface', () => {
    const { ctx } = createRecordingContext();
    drawNeckPhoto(ctx as PhotoContext, null, 100, 100);
  });
});

describe('the zoomed view', () => {
  const notes = makeTimeline([
    { start: 0, end: 0.5, fret: 0 },
    { start: 10, end: 10.5, fret: 17 },
  ]).notesForTrack(0);

  it('shows a closer stretch of the neck than the whole neck', () => {
    expect(zoomedPlacement(1920, 1080, notes, 0).scale).toBeGreaterThan(photoPlacement(1920, 1080).scale);
  });

  it('follows the notes up the neck', () => {
    expect(zoomedPlacement(1920, 1080, notes, 10).centreX).toBeGreaterThan(zoomedPlacement(1920, 1080, notes, 0).centreX);
  });

  it('never looks past either end of the photo or leaves the screen uncovered', () => {
    for (const t of [0, 5, 10, 20]) {
      const p = zoomedPlacement(1920, 1080, notes, t);
      expect(p.centreX - ZOOM_SPAN / 2).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(p.centreX + ZOOM_SPAN / 2).toBeLessThanOrEqual(820 + 1e-9);
    }
  });

  it('is the same for the same time', () => {
    expect(zoomedPlacement(540, 1170, notes, 3.3)).toEqual(zoomedPlacement(540, 1170, notes, 3.3));
  });

  describe('following per bar', () => {
    const centre = (ns: typeof notes, t: number) => zoomedPlacement(1920, 1080, ns, t).centreX;
    // Two-second bars; frets 0 and 17 widen the song past what one view shows.
    const song = makeTimeline([
      { start: 0, end: 0.4, fret: 0 },
      { start: 0.5, end: 0.9, fret: 2 },
      { start: 1, end: 1.4, fret: 3 },
      { start: 2, end: 2.4, fret: 3 },
      { start: 2.5, end: 2.9, fret: 2 },
      { start: 4, end: 4.4, fret: 15 },
      { start: 5, end: 5.4, fret: 17 },
      { start: 6, end: 6.4, fret: 15 },
    ]).notesForTrack(0);

    it('holds still for the whole of a bar', () => {
      const a = centre(song, 0.1);
      for (const t of [0.5, 1, 1.9]) expect(centre(song, t)).toBe(a);
      const b = centre(song, 4.9);
      for (const t of [4.9, 5.5, 5.9]) expect(centre(song, t)).toBe(b);
    });

    it('stays put when the next bar is only a small move away', () => {
      expect(photoNoteX(3) - photoNoteX(2)).toBeLessThan(CAMERA_MOVE_MIN);
      expect(centre(song, 2.2)).toBe(centre(song, 0.1));
    });

    it('moves for a real shift, steadily and without overshoot, and settles on the new bar', () => {
      const before = centre(song, 3);
      const after = centre(song, 5.9);
      expect(after).toBeGreaterThan(before + CAMERA_MOVE_MIN);
      let last = before;
      for (let t = 3; t <= 6; t += 0.05) {
        const c = centre(song, t);
        expect(c).toBeGreaterThanOrEqual(last - 1e-9);
        expect(c).toBeLessThanOrEqual(after + 1e-9);
        last = c;
      }
      expect(centre(song, 6.4)).toBe(after);
    });

    it('frames a repeated section the same way both times', () => {
      const repeat = makeTimeline([
        { start: 0, end: 0.4, fret: 2 },
        { start: 2, end: 2.4, fret: 16 },
        { start: 4, end: 4.4, fret: 2 },
        { start: 6, end: 6.4, fret: 16 },
      ]).notesForTrack(0);
      expect(centre(repeat, 1.0)).toBeCloseTo(centre(repeat, 4.4), 6);
      expect(centre(repeat, 3.5)).toBeCloseTo(centre(repeat, 6.4), 6);
    });
  });

  it('frames the lowest to the highest fret a short-range song uses, and holds still', () => {
    const small = makeTimeline([
      { start: 0, end: 0.5, fret: 2, string: 3 },
      { start: 5, end: 5.5, fret: 7, string: 4 },
    ]).notesForTrack(0);
    const a = zoomedPlacement(1920, 1080, small, 0);
    const b = zoomedPlacement(1920, 1080, small, 5);
    expect(b).toEqual(a);
    for (const fret of [2, 7]) {
      const at = photoToScreen(a, photoNoteX(fret), photoStringY(3, 6, photoNoteX(fret)));
      expect(at.x).toBeGreaterThan(0);
      expect(at.x).toBeLessThan(1920);
    }
    expect(a.scale).toBeGreaterThan(zoomedPlacement(1920, 1080, notes, 0).scale);
  });
});
