import { describe, expect, it } from 'vitest';
import { NECK_PROFILE, PICK_PROFILE, type NeckProfile } from '../../src/render/neck-profile';
import { PICK_SIZE, photoPlacement, photoStringY, photoToScreen, renderNeckView, zoomedPlacement } from '../../src/render/neck-view';
import { PLUCK_SECONDS } from '../../src/render/pick-cues';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1920;
const H = 1080;

function draw(specs: NoteSpec[], t: number, profile: NeckProfile, cues = true): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderNeckView(ctx, makeTimeline(specs, 2, 4), 0, t, W, H, { techniqueCues: cues, profile });
  return calls;
}

const lineTos = (calls: Call[]) => calls.filter((c) => c.name === 'lineTo').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
const arcs = (calls: Call[]) => calls.filter((c) => c.name === 'arc').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number, r: c.args[2] as number, alpha: c.alpha }));
const near = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 0.01) => Math.hypot(a.x - b.x, a.y - b.y) < tol;

/** Where a point at photo-X `px` on `string` lands on the screen. */
function screenAt(profile: NeckProfile, string: number, px: number) {
  return photoToScreen(photoPlacement(W, H, undefined, profile), px, photoStringY(string, 6, px, profile));
}

const picked: NoteSpec[] = [{ start: 1, end: 1.6, string: 3, fret: 5 }];
const pickPoint = (string = 3) => screenAt(PICK_PROFILE, string, PICK_PROFILE.pickX as number);

describe('the string to the pick point', () => {
  it('covers AE1: runs from the ring to the pick point when the profile has one', () => {
    expect(lineTos(draw(picked, 1.5, PICK_PROFILE)).some((p) => near(p, pickPoint()))).toBe(true);
  });

  it('covers AE6: runs only to the end of the strings when it has none', () => {
    const end = screenAt(NECK_PROFILE, 3, NECK_PROFILE.endX);
    const calls = draw(picked, 1.3, NECK_PROFILE);
    expect(lineTos(calls).some((p) => near(p, end))).toBe(true);
    expect(arcs(calls).some((a) => near(a, screenAt(NECK_PROFILE, 3, 880), 3 * photoPlacement(W, H, undefined, NECK_PROFILE).scale))).toBe(false);
  });

  it('leaves the view as it is with technique cues off', () => {
    expect(lineTos(draw(picked, 1.3, PICK_PROFILE, false)).some((p) => near(p, pickPoint()))).toBe(false);
  });
});

describe('the pick flash', () => {
  it('covers AE1: flashes on the note string at the pick point as the note starts', () => {
    const flash = arcs(draw(picked, 1, PICK_PROFILE)).filter((a) => near(a, pickPoint(), 0.5));
    expect(flash.length).toBeGreaterThan(0);
    expect(flash.every((a) => a.r > 0 && a.alpha > 0)).toBe(true);
  });

  it('has faded once the flash time has passed', () => {
    expect(arcs(draw(picked, 1.3, PICK_PROFILE)).filter((a) => near(a, pickPoint(), 0.5))).toHaveLength(0);
  });

  it('does not flash a note that is not picked, such as a pull-off destination', () => {
    const specs: NoteSpec[] = [
      { start: 0.5, end: 1, string: 3, fret: 7, techniques: { hammerPull: 'origin' } },
      { start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'destination' } },
    ];
    expect(arcs(draw(specs, 1, PICK_PROFILE)).filter((a) => near(a, pickPoint(), 0.5))).toHaveLength(0);
  });
});

describe('the pluck wobble', () => {
  it('covers AE2: shakes the string at the moment of the pick and is still once settled', () => {
    const settled = pickPoint();
    const at = (t: number) => lineTos(draw(picked, t, PICK_PROFILE)).filter((p) => Math.abs(p.x - settled.x) < 0.01);
    const shaking = at(1);
    expect(shaking.length).toBeGreaterThan(0);
    expect(shaking.some((p) => Math.abs(p.y - settled.y) > 0.5)).toBe(true);
    const still = at(1 + PLUCK_SECONDS + 0.01);
    expect(still.every((p) => Math.abs(p.y - settled.y) < 0.01)).toBe(true);
  });

  it('covers AE2: never shakes the string of a pull-off destination', () => {
    const specs: NoteSpec[] = [
      { start: 0.5, end: 1, string: 3, fret: 7, techniques: { hammerPull: 'origin' } },
      { start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'destination' } },
    ];
    const settled = pickPoint();
    const ends = lineTos(draw(specs, 1.02, PICK_PROFILE)).filter((p) => Math.abs(p.x - settled.x) < 0.01);
    expect(ends.every((p) => Math.abs(p.y - settled.y) < 0.01)).toBe(true);
  });

  it('covers AE3: adds the wobble to a bend rather than replacing it', () => {
    const bent: NoteSpec[] = [{ start: 1, end: 2, string: 3, fret: 5, techniques: { bend: 2 } }];
    const settledTime = 1 + PLUCK_SECONDS + 0.01;
    // the bend's own deflection stays after the shake has settled, and the shake changes where the string ends up at the pick
    const early = lineTos(draw(bent, 1.01, PICK_PROFILE));
    const late = lineTos(draw(bent, settledTime, PICK_PROFILE));
    expect(early).not.toEqual(late);
    expect(late.some((p) => Math.abs(p.y - pickPoint().y) < 0.01 && Math.abs(p.x - pickPoint().x) < 0.01)).toBe(true);
  });
});

describe('the pick marker', () => {
  it('is drawn as a closed shape that sits on the string it last played', () => {
    const calls = draw(picked, 1.4, PICK_PROFILE);
    const onWith = draw(picked, 1.4, PICK_PROFILE, false);
    expect(calls.filter((c) => c.name === 'closePath').length).toBeGreaterThan(onWith.filter((c) => c.name === 'closePath').length);
  });

  it('sits on the string it last played, in the neighbourhood of the pick point', () => {
    for (const string of [2, 5]) {
      const specs: NoteSpec[] = [{ start: 1, end: 1.6, string, fret: 5 }];
      const corners = draw(specs, 1.4, PICK_PROFILE)
        .filter((c) => c.name === 'quadraticCurveTo')
        .slice(-3)
        .map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
      const centroid = { x: (corners[0].x + corners[1].x + corners[2].x) / 3, y: (corners[0].y + corners[1].y + corners[2].y) / 3 };
      const size = PICK_SIZE * photoPlacement(W, H, undefined, PICK_PROFILE).scale;
      expect(Math.hypot(centroid.x - pickPoint(string).x, centroid.y - pickPoint(string).y)).toBeLessThan(size * 0.5);
    }
  });

  it('is the same at the same time on repeated draws', () => {
    expect(draw(picked, 1.02, PICK_PROFILE)).toEqual(draw(picked, 1.02, PICK_PROFILE));
  });
});

describe('the framing', () => {
  const inFrame = (place: ReturnType<typeof photoPlacement>, w: number, h: number) => {
    const p = photoToScreen(place, PICK_PROFILE.pickX as number, photoStringY(3, 6, PICK_PROFILE.pickX as number, PICK_PROFILE));
    return p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  };
  const low = makeTimeline([1, 2, 3, 4].map((start, i) => ({ start, end: start + 0.5, string: 1 + i, fret: 1 + i }))).notesForTrack(0);
  // a song that spans the whole neck, so the camera follows it
  const wide = makeTimeline([2, 5, 9, 14, 19, 22].map((fret, i) => ({ start: 0.5 + i * 2, end: 1.2 + i * 2, string: 2, fret }))).notesForTrack(0);

  it('covers AE15: keeps the pick point in frame for a song in the low frets, on a wide and on a tall screen', () => {
    for (const [w, h] of [[1920, 1080], [540, 1170]]) {
      expect(inFrame(zoomedPlacement(w, h, low, 2, 6, PICK_PROFILE), w, h)).toBe(true);
    }
  });

  it('keeps it in frame all through a following camera move, which never jumps from frame to frame', () => {
    let before: number | null = null;
    for (let t = 0; t <= 12; t += 0.02) {
      const place = zoomedPlacement(1920, 1080, wide, t, 6, PICK_PROFILE);
      expect(inFrame(place, 1920, 1080)).toBe(true);
      if (before !== null) expect(Math.abs(place.centreX - before)).toBeLessThan(25);
      before = place.centreX;
    }
  });

  it('zooms in less than it does for a photo with no pick point, to make room', () => {
    expect(zoomedPlacement(1920, 1080, low, 2, 6, PICK_PROFILE).scale).toBeLessThan(
      zoomedPlacement(1920, 1080, low, 2, 6, { ...PICK_PROFILE, pickX: undefined }).scale,
    );
  });

});

describe('the dimming', () => {
  const dimmed = (profile: NeckProfile) => draw(picked, 1.5, profile).filter((c) => c.name === 'fill' && Math.abs(c.alpha - 0.62) < 1e-9).length;

  it('dims the body as much as the table, so no edge shows where the board ends', () => {
    expect(dimmed(NECK_PROFILE)).toBe(4);
    expect(dimmed(PICK_PROFILE)).toBe(4);
  });
});

describe('a pick on the edge strings', () => {
  const onEdge = (string: number, stroke: 'up' | 'down'): NoteSpec[] => [{ start: 1, end: 1.6, string, fret: 5, stroke }];

  it('draws an up stroke on the high-e string, where there is no higher string to point toward', () => {
    for (const t of [0.95, 1, 1.05, 1.3]) {
      expect(() => draw(onEdge(1, 'up'), t, PICK_PROFILE)).not.toThrow();
    }
  });

  it('draws a down stroke on the low string, where there is no lower string to point toward', () => {
    for (const t of [0.95, 1, 1.05, 1.3]) {
      expect(() => draw(onEdge(6, 'down'), t, PICK_PROFILE)).not.toThrow();
    }
  });

  it('points the pick tip the way the stroke goes: toward the low strings on a down stroke, away on an up stroke', () => {
    const tipOf = (stroke: 'up' | 'down') => {
      const calls = draw(onEdge(3, stroke), 1.4, PICK_PROFILE);
      // the pick is the last closed shape drawn; its first move is the midpoint of the tip-to-right edge, its first curve's control point is the tip
      const curves = calls.filter((c) => c.name === 'quadraticCurveTo');
      const first = curves[curves.length - 6];
      const centre = pickPoint(3);
      return { x: first.args[0] as number - centre.x, y: first.args[1] as number - centre.y };
    };
    // string 3 -> string 4 is down the photo (higher y); a down stroke leans that way, an up stroke the other way
    expect(tipOf('down').y).toBeGreaterThan(0);
    expect(tipOf('up').y).toBeLessThan(0);
  });
});
