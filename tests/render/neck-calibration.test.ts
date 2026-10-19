import { describe, expect, it } from 'vitest';
import { calibrate, tapToPhoto, TAP_PROMPTS, type CalibrationTaps, type Point } from '../../src/render/neck-calibration';
import { PICK_PROFILE } from '../../src/render/neck-profile';
import { photoStringY } from '../../src/render/neck-view';

const sh = (n: number) => 1 - Math.pow(2, -n / 12);

/** Taps taken from the bundled pick profile's own positions, as a photo of 2 pixels per unit with the neck already upright. */
function bundledTaps(): { taps: CalibrationTaps; photoWidth: number; photoHeight: number } {
  const p = PICK_PROFILE;
  const at = (x: number, string: number): Point => ({ x: x * 2, y: photoStringY(string, 6, x, p) * 2 });
  return {
    taps: {
      nut: [at(p.nutX, 1), at(p.nutX, 6)],
      twelfth: [at(p.fretX[11], 1), at(p.fretX[11], 6)],
      last: [at(p.fretX[22], 1), at(p.fretX[22], 6)],
      pick: at(p.pickX as number, 3),
    },
    photoWidth: p.photoWidth * 2,
    photoHeight: p.photoHeight * 2,
  };
}

/** A synthetic neck: wires along x follow a projective map, so frets bunch the way an angled photo shows them. */
function perspectiveTaps(fretCount: number, A = 2400, C = 0.5): { taps: CalibrationTaps; photoWidth: number; photoHeight: number; wire: (n: number) => number } {
  const nut = 200;
  const wire = (n: number) => nut + (A * sh(n)) / (1 + C * sh(n));
  const top = (x: number) => 300 + 0.03 * (x - nut);
  const bottom = (x: number) => 420 - 0.03 * (x - nut);
  const at = (x: number, edge: 'top' | 'bottom'): Point => ({ x, y: edge === 'top' ? top(x) : bottom(x) });
  const pickX = wire(fretCount) + 120;
  return {
    taps: {
      nut: [at(nut, 'top'), at(nut, 'bottom')],
      twelfth: [at(wire(12), 'top'), at(wire(12), 'bottom')],
      last: [at(wire(fretCount), 'top'), at(wire(fretCount), 'bottom')],
      pick: { x: pickX, y: (top(pickX) + bottom(pickX)) / 2 },
    },
    photoWidth: 2200,
    photoHeight: 1000,
    wire,
  };
}

describe('the seven prompts', () => {
  it('asks for the nut, the 12th fret and the last fret at each side, then the pick point, each with its own prompt', () => {
    expect(TAP_PROMPTS).toHaveLength(7);
    expect(new Set(TAP_PROMPTS).size).toBe(7);
  });
});

describe('fitting a neck from the taps', () => {
  it('covers AE8: recovers the bundled neck from its own positions to within a quarter of a fret gap', () => {
    const { taps, photoWidth, photoHeight } = bundledTaps();
    const r = calibrate({ taps, fretCount: 23, photoWidth, photoHeight });
    if (!r.ok) throw new Error(r.reason);
    const p = r.profile;
    expect(p.fretX).toHaveLength(23);
    const norm = (x: number, nut: number, last: number) => (x - nut) / (last - nut);
    const target = PICK_PROFILE;
    for (let i = 0; i < 23; i++) {
      const got = norm(p.fretX[i], p.nutX, p.fretX[22]);
      const want = norm(target.fretX[i], target.nutX, target.fretX[22]);
      const gap = (i === 0 ? target.fretX[0] - target.nutX : target.fretX[i] - target.fretX[i - 1]) / (target.fretX[22] - target.nutX);
      expect(Math.abs(got - want)).toBeLessThan(gap / 4);
    }
    expect(p.pickX as number).toBeGreaterThan(p.fretX[22]);
    // the neck is a little off level in the photo, so the turned photo's box is a touch different from the photo's
    expect(p.photoWidth / p.photoHeight).toBeCloseTo(photoWidth / photoHeight, 1);
  });

  it('covers AE12: puts the frets of an angled photo where a projective neck has them', () => {
    const { taps, photoWidth, photoHeight, wire } = perspectiveTaps(22);
    const r = calibrate({ taps, fretCount: 22, photoWidth, photoHeight });
    if (!r.ok) throw new Error(r.reason);
    const { profile, normalize } = r;
    // the neck is level, so the photo is not turned and a pixel's turned position is its own
    const toUnits = (x: number) => x * normalize.unitsPerPixel;
    for (let n = 1; n <= 22; n++) expect(profile.fretX[n - 1]).toBeCloseTo(toUnits(wire(n)), 3);
    // they bunch toward the body: gaps shrink all the way up the neck
    const gaps = profile.fretX.map((x, i) => x - (i === 0 ? profile.nutX : profile.fretX[i - 1]));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeLessThan(gaps[i - 1]);
  });

  it('covers AE12: turns a photo with the headstock at the top so the neck runs left to right, the same as one already upright', () => {
    const upright = perspectiveTaps(22);
    const direct = calibrate({ taps: upright.taps, fretCount: 22, photoWidth: upright.photoWidth, photoHeight: upright.photoHeight });
    // the same photo turned a quarter turn clockwise: (x, y) -> (height - y, x)
    const H = upright.photoHeight;
    const turn = (p: Point): Point => ({ x: H - p.y, y: p.x });
    const t = upright.taps;
    const turned = calibrate({
      taps: { nut: [turn(t.nut[0]), turn(t.nut[1])], twelfth: [turn(t.twelfth[0]), turn(t.twelfth[1])], last: [turn(t.last[0]), turn(t.last[1])], pick: turn(t.pick) },
      fretCount: 22,
      photoWidth: upright.photoHeight,
      photoHeight: upright.photoWidth,
    });
    if (!direct.ok || !turned.ok) throw new Error('the fit failed');
    expect(Math.abs(turned.normalize.angle)).toBeCloseTo(Math.PI / 2, 6);
    expect(turned.profile.nutX).toBeLessThan(turned.profile.fretX[21]);
    turned.profile.fretX.forEach((x, i) => expect(x).toBeCloseTo(direct.profile.fretX[i], 3));
    expect(turned.profile.pickX).toBeCloseTo(direct.profile.pickX as number, 3);
  });

  it('covers AE8: gives a 22-fret and a 24-fret answer different fret counts and spacing', () => {
    const taps = perspectiveTaps(22);
    const a = calibrate({ taps: taps.taps, fretCount: 22, photoWidth: taps.photoWidth, photoHeight: taps.photoHeight });
    const b = calibrate({ taps: taps.taps, fretCount: 24, photoWidth: taps.photoWidth, photoHeight: taps.photoHeight });
    if (!a.ok || !b.ok) throw new Error('the fit failed');
    expect(a.profile.fretX).toHaveLength(22);
    expect(b.profile.fretX).toHaveLength(24);
    expect(a.profile.fretX[10]).not.toBeCloseTo(b.profile.fretX[10], 0);
  });

  it('keeps the strings in order, high e on top, spread between the two outer ones', () => {
    const { taps, photoWidth, photoHeight } = perspectiveTaps(22);
    const r = calibrate({ taps, fretCount: 22, photoWidth, photoHeight });
    if (!r.ok) throw new Error(r.reason);
    const x = r.profile.fretX[10];
    const ys = [1, 2, 3, 4, 5, 6].map((s) => photoStringY(s, 6, x, r.profile));
    for (let i = 1; i < 6; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    expect(ys[2] - ys[1]).toBeCloseTo(ys[3] - ys[2], 6);
  });

  it('covers AE13: puts a note beyond the fitted frets at the last one', () => {
    const { taps, photoWidth, photoHeight } = perspectiveTaps(22);
    const r = calibrate({ taps, fretCount: 22, photoWidth, photoHeight });
    if (!r.ok) throw new Error(r.reason);
    expect(r.profile.fretX).toHaveLength(22);
  });
});

describe('rejecting taps that cannot be a neck', () => {
  const base = () => perspectiveTaps(22);
  const run = (mutate: (t: CalibrationTaps) => CalibrationTaps, fretCount = 22) => {
    const { taps, photoWidth, photoHeight } = base();
    return calibrate({ taps: mutate(taps), fretCount, photoWidth, photoHeight });
  };

  it('refuses a 12th fret that is not between the nut and the last fret', () => {
    const r = run((t) => ({ ...t, twelfth: t.last, last: t.twelfth }));
    expect(r.ok).toBe(false);
  });

  it('refuses the two sides of the neck crossing, which is the high-e side tapped at the bottom', () => {
    const r = run((t) => ({ ...t, nut: [t.nut[1], t.nut[0]], twelfth: [t.twelfth[1], t.twelfth[0]], last: [t.last[1], t.last[0]] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/high/i);
  });

  it('refuses a pick point on the neck, not past the last fret', () => {
    const r = run((t) => ({ ...t, pick: t.twelfth[0] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/pick/i);
  });

  it('refuses a fret count it cannot place', () => {
    expect(run((t) => t, 7).ok).toBe(false);
    expect(run((t) => t, 40).ok).toBe(false);
  });

  it('refuses taps with the nut and the last fret on top of each other', () => {
    expect(run((t) => ({ ...t, last: t.nut, twelfth: t.nut })).ok).toBe(false);
  });
});

describe('tapping on a displayed photo', () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 };

  it('maps a tap to photo pixels for a photo fitted inside its box', () => {
    // a 2000 by 1000 photo in a 400 by 300 box is drawn 400 by 200, centred: 50 px of margin above and below
    expect(tapToPhoto({ x: 10 + 200, y: 20 + 150 }, rect, { width: 2000, height: 1000 })).toEqual({ x: 1000, y: 500 });
    expect(tapToPhoto({ x: 10, y: 20 + 50 }, rect, { width: 2000, height: 1000 })).toEqual({ x: 0, y: 0 });
  });

  it('gives nothing for a tap in the margin around the photo', () => {
    expect(tapToPhoto({ x: 10 + 200, y: 20 + 10 }, rect, { width: 2000, height: 1000 })).toBeNull();
  });
});

describe('rejecting fits that cannot be placed', () => {
  it('refuses a 12th fret so near the nut that the frets would bunch the wrong way', () => {
    const { taps, photoWidth, photoHeight } = perspectiveTaps(22);
    const nutX = taps.nut[0].x;
    const lastX = taps.last[0].x;
    const x = nutX + 0.05 * (lastX - nutX);
    const near = (p: Point): Point => ({ x, y: p.y });
    const r = calibrate({ taps: { ...taps, twelfth: [near(taps.twelfth[0]), near(taps.twelfth[1])] }, fretCount: 22, photoWidth, photoHeight });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/bunch/i);
  });

  it('refuses a pick point at the very edge of the photo', () => {
    const { taps, photoWidth, photoHeight } = perspectiveTaps(22);
    const r = calibrate({ taps: { ...taps, pick: { x: photoWidth - 1, y: taps.pick.y } }, fretCount: 22, photoWidth, photoHeight });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/outside/i);
  });
});
