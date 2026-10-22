import { describe, expect, it } from 'vitest';
import { BASS_PROFILE, isNeckProfile, neckPhotoKind, neckProfileFor, NECK_PROFILE, PICK_PROFILE, type NeckProfile } from '../../src/render/neck-profile';
import { PHOTO_FRET_COUNT, photoNoteX, photoNoteXAt, photoPlacement, photoRingRadius, photoStringY, photoToScreen, renderNeckView } from '../../src/render/neck-view';
import { makeTimeline } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';

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

      it('has its strings strictly ordered from the high one to the low one at every knot', () => {
        expect(p.stringKnotsY.length).toBeGreaterThanOrEqual(2);
        p.stringKnotsX.forEach((_, k) => {
          for (let s = 1; s < p.stringKnotsY.length; s++) expect(p.stringKnotsY[s][k]).toBeGreaterThan(p.stringKnotsY[s - 1][k]);
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
  sane('BASS_PROFILE', BASS_PROFILE);

  it('gives the Real guitar view no pick point', () => {
    expect(NECK_PROFILE.pickX).toBeUndefined();
  });

  it('gives the bass photo four strings, twenty frets and no pick point', () => {
    expect(BASS_PROFILE.stringKnotsY).toHaveLength(4);
    expect(BASS_PROFILE.fretX).toHaveLength(20);
    expect(BASS_PROFILE.pickX).toBeUndefined();
    expect(isNeckProfile(BASS_PROFILE)).toBe(true);
  });

  it('keeps the bass photo the same shape as its image (1024 by 572)', () => {
    expect(BASS_PROFILE.photoWidth / BASS_PROFILE.photoHeight).toBeCloseTo(1024 / 572, 2);
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

describe('a profile with four string rows', () => {
  const four: NeckProfile = {
    ...NECK_PROFILE,
    stringKnotsX: [100, 400, 800],
    stringKnotsY: [
      [200, 198, 196],
      [230, 232, 234],
      [260, 266, 272],
      [290, 300, 310],
    ],
  };

  it('puts the outer strings on its first and last rows', () => {
    expect(photoStringY(1, 4, 100, four)).toBe(200);
    expect(photoStringY(4, 4, 100, four)).toBe(290);
    expect(photoStringY(4, 4, 800, four)).toBe(310);
  });

  it('keeps the middle strings between the outer two, in order, between knots', () => {
    const ys = [1, 2, 3, 4].map((s) => photoStringY(s, 4, 250, four));
    for (let i = 1; i < 4; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it('is accepted as a profile, but not with one row or ragged rows', () => {
    expect(isNeckProfile(four)).toBe(true);
    expect(isNeckProfile({ ...four, stringKnotsY: [four.stringKnotsY[0]] })).toBe(false);
    expect(isNeckProfile({ ...four, stringKnotsY: [...four.stringKnotsY.slice(0, 3), [1, 2]] })).toBe(false);
  });

  it('draws the board edges just outside its own outer strings', () => {
    const { ctx, calls } = createRecordingContext();
    renderNeckView(ctx, makeTimeline([], 2, 4, 4), 0, 0, 1920, 1080, { profile: four });
    const place = photoPlacement(1920, 1080, undefined, four);
    const ys = calls.filter((c) => c.name === 'lineTo').map((c) => c.args[1] as number);
    const left = four.nutX - 2;
    const topEdge = photoToScreen(place, left, photoStringY(1, 4, left, four) - 6).y;
    expect(ys.some((y) => Math.abs(y - topEdge) < 1e-6)).toBe(true);
  });
});

describe('which photo a track gets', () => {
  it('gives exactly four strings the bass photo and everything else the guitar photo', () => {
    expect(neckProfileFor(4)).toBe(BASS_PROFILE);
    for (const count of [0, 1, 3, 5, 6, 7, 8]) expect(neckProfileFor(count)).toBe(NECK_PROFILE);
    expect(neckPhotoKind(4)).toBe('bass');
    expect([5, 6, 7].map(neckPhotoKind)).toEqual(['guitar', 'guitar', 'guitar']);
  });
});
