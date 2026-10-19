import { describe, expect, it } from 'vitest';
import { MAX_LONG_SIDE, normalizeTransform, normalizedSize } from '../../src/app/normalize-photo';
import { calibrate, type NormalizeSpec } from '../../src/render/neck-calibration';

const spec = (angle: number, width: number, height: number, minX: number, minY: number, centre = { x: width / 2, y: height / 2 }): NormalizeSpec => ({
  angle,
  centre,
  minX,
  minY,
  width,
  height,
  unitsPerPixel: 0.5,
});

describe('normalizing a photo for the pick view', () => {
  it('keeps a photo at its own size when it is within the cap', () => {
    expect(normalizedSize(spec(0, 1600, 800, -800, -400))).toEqual({ width: 1600, height: 800, scale: 1 });
  });

  it('covers AE: stores a photo over the size cap downscaled to the cap, keeping its shape', () => {
    const s = normalizedSize(spec(0, 4096, 2048, -2048, -1024));
    expect(Math.max(s.width, s.height)).toBe(MAX_LONG_SIDE);
    expect(s.width / s.height).toBeCloseTo(2, 2);
    expect(s.scale).toBeCloseTo(MAX_LONG_SIDE / 4096, 9);
  });

  it('maps an unturned photo straight onto the box', () => {
    const [a, b, c, d, e, f] = normalizeTransform(spec(0, 1600, 800, -800, -400), 1);
    [a, b, c, d].forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1][i], 9));
    // the photo's top-left corner lands at the box's top-left
    expect(e).toBeCloseTo(0, 9);
    expect(f).toBeCloseTo(0, 9);
  });

  it('maps a photo turned a quarter turn so its corner lands inside the box', () => {
    // a 2000 by 1000 photo turned by -90 degrees is 1000 wide and 2000 tall; its box starts at (-500, -1000) in the turned frame
    const t = normalizeTransform(spec(-Math.PI / 2, 1000, 2000, -500, -1000, { x: 1000, y: 500 }), 1);
    const apply = (x: number, y: number) => ({ x: t[0] * x + t[2] * y + t[4], y: t[1] * x + t[3] * y + t[5] });
    for (const [x, y] of [[0, 0], [2000, 0], [0, 1000], [2000, 1000]] as const) {
      const p = apply(x, y);
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(1000 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(2000 + 1e-6);
    }
  });
});

describe('normalizing agrees with the fit', () => {
  const sh = (n: number) => 1 - Math.pow(2, -n / 12);
  const wire = (n: number) => 200 + (2400 * sh(n)) / (1 + 0.5 * sh(n));
  const top = (x: number) => 300 + 0.03 * (x - 200);
  const bottom = (x: number) => 420 - 0.03 * (x - 200);
  const taps = (turn: (p: { x: number; y: number }) => { x: number; y: number }) => {
    const at = (x: number, edge: 'top' | 'bottom') => turn({ x, y: edge === 'top' ? top(x) : bottom(x) });
    return {
      nut: [at(200, 'top'), at(200, 'bottom')] as const,
      twelfth: [at(wire(12), 'top'), at(wire(12), 'bottom')] as const,
      last: [at(wire(22), 'top'), at(wire(22), 'bottom')] as const,
      pick: turn({ x: wire(22) + 120, y: 360 }),
    };
  };

  it('puts the original taps where the fitted profile says the nut, last fret and pick point are, whichever way the photo was turned', () => {
    const H = 1000;
    const cases = [
      { photo: { width: 2200, height: 1000 }, turn: (p: { x: number; y: number }) => p },
      // a quarter turn clockwise: the headstock ends up at the top
      { photo: { width: 1000, height: 2200 }, turn: (p: { x: number; y: number }) => ({ x: H - p.y, y: p.x }) },
      // a quarter turn the other way: the headstock at the bottom
      { photo: { width: 1000, height: 2200 }, turn: (p: { x: number; y: number }) => ({ x: p.y, y: 2200 - p.x }) },
    ];
    for (const { photo, turn } of cases) {
      const t = taps(turn);
      const r = calibrate({ taps: t, fretCount: 22, photoWidth: photo.width, photoHeight: photo.height });
      if (!r.ok) throw new Error(r.reason);
      const m = normalizeTransform(r.normalize, 1);
      const toUnits = (p: { x: number; y: number }) => ({
        x: (m[0] * p.x + m[2] * p.y + m[4]) * r.normalize.unitsPerPixel,
        y: (m[1] * p.x + m[3] * p.y + m[5]) * r.normalize.unitsPerPixel,
      });
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      expect(toUnits(mid(t.nut[0], t.nut[1])).x).toBeCloseTo(r.profile.nutX, 6);
      expect(toUnits(mid(t.last[0], t.last[1])).x).toBeCloseTo(r.profile.fretX[21], 6);
      expect(toUnits(t.pick).x).toBeCloseTo(r.profile.pickX as number, 6);
      // the high e string tap lands above the low E string tap, so the neck is the right way up
      expect(toUnits(t.nut[0]).y).toBeLessThan(toUnits(t.nut[1]).y);
    }
  });
});
