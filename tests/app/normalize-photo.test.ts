import { describe, expect, it } from 'vitest';
import { MAX_LONG_SIDE, normalizeTransform, normalizedSize } from '../../src/app/normalize-photo';
import type { NormalizeSpec } from '../../src/render/neck-calibration';

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
