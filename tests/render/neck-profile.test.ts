import { describe, expect, it } from 'vitest';
import { NECK_PROFILE, PICK_PROFILE, type NeckProfile } from '../../src/render/neck-profile';
import { PHOTO_FRET_COUNT, photoNoteX, photoNoteXAt, photoPlacement, photoRingRadius, photoStringY } from '../../src/render/neck-view';

describe('the Real guitar view keeps its numbers (characterization)', () => {
  it('places rings at the same photo X', () => {
    expect([0, 1, 2, 5, 12, 23, 30].map((f) => photoNoteX(f))).toEqual([120, 158, 205, 336, 575, 802.5, 802.5]);
    expect([0.5, 3.25, 11.75].map((f) => photoNoteXAt(f))).toEqual([139, 261.5, 567.625]);
    expect(PHOTO_FRET_COUNT).toBe(23);
  });

  it('sizes rings and finds strings as before', () => {
    expect([0, 1, 7].map((f) => photoRingRadius(f))).toEqual([6.5, 6.5, 6.5]);
    expect(photoRingRadius(23)).toBeCloseTo(5.4, 10);
    const y = (s: number) => [140, 400, 700, 900].map((x) => photoStringY(s, 6, x));
    expect(y(1)[0]).toBe(208);
    expect(y(1)[1]).toBeCloseTo(204.714285714, 6);
    expect(y(3)[2]).toBeCloseTo(229.153846153, 6);
    expect(y(6)[3]).toBeCloseTo(277.076923076, 6);
    expect(photoStringY(1, 4, 500)).toBeCloseTo(203.285714285, 6);
    expect(photoStringY(4, 4, 500)).toBeCloseTo(267.428571428, 6);
  });

  it('places the photo on a landscape and a portrait screen as before', () => {
    expect(photoPlacement(1000, 500)).toMatchObject({ rotated: false, scale: 1.25, centreX: 420, centreY: 236 });
    expect(photoPlacement(500, 1000)).toMatchObject({ rotated: true, scale: 1.25, centreX: 420, centreY: 236 });
    expect(photoPlacement(1000, 500, { centreX: 300, span: 480, centreY: 230 })).toMatchObject({ scale: 2.0833333333333335, centreX: 300, centreY: 230 });
  });
});

describe('neck profiles', () => {
  const sane = (name: string, p: NeckProfile) => {
    describe(name, () => {
      it('has the nut before strictly increasing fret wires', () => {
        expect(p.fretX[0]).toBeGreaterThan(p.nutX);
        for (let i = 1; i < p.fretX.length; i++) expect(p.fretX[i]).toBeGreaterThan(p.fretX[i - 1]);
      });

      it('has six strings that are strictly ordered from the high one to the low one at every knot', () => {
        expect(p.stringKnotsY).toHaveLength(6);
        p.stringKnotsX.forEach((_, k) => {
          for (let s = 1; s < 6; s++) expect(p.stringKnotsY[s][k]).toBeGreaterThan(p.stringKnotsY[s - 1][k]);
        });
      });

      it('keeps the strings and frets inside the photo', () => {
        expect(p.fretX[p.fretX.length - 1]).toBeLessThan(p.photoWidth);
        expect(p.endX).toBeLessThanOrEqual(p.photoWidth);
        for (const row of p.stringKnotsY) for (const y of row) expect(y).toBeGreaterThan(0), expect(y).toBeLessThan(p.photoHeight);
      });
    });
  };
  sane('NECK_PROFILE', NECK_PROFILE);
  sane('PICK_PROFILE', PICK_PROFILE);

  it('gives the Real guitar view no pick point', () => {
    expect(NECK_PROFILE.pickX).toBeUndefined();
  });

  it('puts the new view pick point beyond its last fret and inside its photo', () => {
    expect(PICK_PROFILE.pickX).toBeDefined();
    expect(PICK_PROFILE.pickX as number).toBeGreaterThan(PICK_PROFILE.fretX[PICK_PROFILE.fretX.length - 1]);
    expect(PICK_PROFILE.pickX as number).toBeLessThan(PICK_PROFILE.photoWidth);
  });

  it('keeps the new view photo the same shape as its image (1920 by 961)', () => {
    expect(PICK_PROFILE.photoWidth / PICK_PROFILE.photoHeight).toBeCloseTo(1920 / 961, 2);
  });

  it('gives the new view 23 frets, like the Real guitar view', () => {
    expect(PICK_PROFILE.fretX).toHaveLength(23);
  });

  it('moves rings and wires when a profile has a different nut and fret list', () => {
    const shifted: NeckProfile = { ...NECK_PROFILE, nutX: NECK_PROFILE.nutX + 50, fretX: NECK_PROFILE.fretX.map((x) => x + 50) };
    expect(photoNoteX(5, shifted)).toBe(photoNoteX(5) + 50);
    expect(photoPlacement(1000, 500, undefined, shifted).profile).toBe(shifted);
  });
});
