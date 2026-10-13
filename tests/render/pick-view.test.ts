import { describe, expect, it } from 'vitest';
import { NECK_PROFILE, PICK_PROFILE, type NeckProfile } from '../../src/render/neck-profile';
import { photoPlacement, photoStringY, photoToScreen, renderNeckView } from '../../src/render/neck-view';
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

  it('is the same at the same time on repeated draws', () => {
    expect(draw(picked, 1.02, PICK_PROFILE)).toEqual(draw(picked, 1.02, PICK_PROFILE));
  });
});
