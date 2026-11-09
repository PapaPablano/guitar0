/**
 * Where everything sits on a neck photo, in the photo's own pixels with the headstock on the left: the nut, each fret wire,
 * the strings, where they end and, for photos that show the body, the point the pick lands. The neck view draws against
 * a profile, so a different photo only needs a different profile.
 */
export interface NeckProfile {
  readonly photoWidth: number;
  readonly photoHeight: number;
  /** X of the nut. */
  readonly nutX: number;
  /** X of each fret wire from fret 1 up. */
  readonly fretX: readonly number[];
  /** X where the strings end in the photo (the bridge, or the photo's edge). */
  readonly endX: number;
  /** Y of each string (high one first; six on the guitar photos, four on the bass photo) at the X positions in `stringKnotsX`; between them the strings run straight. */
  readonly stringKnotsX: readonly number[];
  readonly stringKnotsY: readonly (readonly number[])[];
  /** The stretch of the photo the view shows, and the row the neck runs along. */
  readonly viewStart: number;
  readonly viewEnd: number;
  readonly neckRow: number;
  /** The frets that carry an inlay, which get a number under the board. */
  readonly inlayFrets: readonly number[];
  /** X of the point the pick lands on the strings; absent for a photo that shows no body, which gets no pick effects. */
  readonly pickX?: number;
}

/** The photo the Real guitar view has always used: measured by hand, headstock on the left, ending at the bridge. */
export const NECK_PROFILE: NeckProfile = {
  photoWidth: 949,
  photoHeight: 475,
  nutX: 134,
  fretX: [182, 228, 273, 316, 356, 396, 430, 464, 499, 531, 560, 590, 617, 643, 667, 688, 709, 728, 746, 763, 779, 795, 810],
  endX: 945,
  stringKnotsX: [140, 270, 380, 520, 680, 810],
  stringKnotsY: [
    [208, 206, 205, 203, 201, 199],
    [217, 217, 216, 216, 215, 215],
    [227, 227, 228, 229, 229, 230],
    [237, 238, 240, 241, 243, 245],
    [247, 250, 252, 254, 258, 260],
    [257, 261, 264, 268, 272, 275],
  ],
  viewStart: 20,
  viewEnd: 820,
  neckRow: 236,
  inlayFrets: [3, 5, 7, 9, 12, 14, 16, 18, 20, 23],
};

/**
 * The photo the pick view ships with: the same guitar from above, headstock on the left, with the neck running on into the body
 * so the strings cross a pickup. Measured from the 1920 by 961 image, in half-size units.
 */
export const PICK_PROFILE: NeckProfile = {
  photoWidth: 960,
  photoHeight: 481,
  nutX: 134.5,
  fretX: [184, 231, 276.5, 319, 361, 400.5, 437, 470, 504.5, 537.5, 567.5, 597.5, 625, 651, 675, 697, 718.5, 737.5, 755.5, 772.5, 789, 805, 820],
  endX: 960,
  stringKnotsX: [160, 450, 750, 930],
  stringKnotsY: [
    [209.3, 205.8, 202.3, 200.2],
    [219.3, 218.2, 217.1, 216.4],
    [229, 230.4, 231.8, 232.6],
    [239.3, 242.9, 246.6, 248.9],
    [250, 255.7, 261.6, 265.1],
    [260.5, 268.3, 276.4, 281.2],
  ],
  viewStart: 20,
  viewEnd: 940,
  neckRow: 238,
  inlayFrets: [3, 5, 7, 9, 12, 14, 16, 18, 20, 23],
  pickX: 880,
};

/**
 * The bass photo: a 4-string Jazz Bass with 20 frets, headstock on the left, ending at the bridge. Measured from the 1024 by 572
 * image in units of 1.35 photo pixels, so the 12th fret sits about as far from the nut as on the guitar photo. The body shows past the
 * neck but has no pick point, so the pick effects do not apply to it.
 */
export const BASS_PROFILE: NeckProfile = {
  photoWidth: 1382,
  photoHeight: 772,
  nutX: 279,
  fretX: [334.3, 384.8, 432.4, 477.4, 520.6, 561.7, 600.1, 636.7, 671.4, 704, 734.9, 764.1, 791.9, 818.8, 844.3, 868.6, 891.5, 913.3, 933.8, 953.6],
  endX: 1255.5,
  stringKnotsX: [279.5, 734.9, 953.6, 1255.5],
  stringKnotsY: [
    [363.6, 356.1, 351.9, 346.1],
    [375.8, 373.3, 372.1, 369.8],
    [388.3, 390.8, 392, 393.8],
    [401.2, 408.6, 412.6, 417.7],
  ],
  viewStart: 165,
  viewEnd: 1050,
  neckRow: 382.4,
  inlayFrets: [3, 5, 7, 9, 12, 15, 17, 19],
};

/**
 * The bass photo with a pick point, for the pick view: the same measurements, plus the point between the two pickups where the
 * picking hand lands. A bass track's pick view draws on this photo instead of the guitar's, so it carries pick effects too.
 */
export const BASS_PICK_PROFILE: NeckProfile = { ...BASS_PROFILE, pickX: 1160 };

/** Which of the bundled photos a track's neck is drawn on: the bass photo for exactly four strings, the guitar photo for any other count. */
export type NeckPhotoKind = 'guitar' | 'bass';

export function neckPhotoKind(stringCount: number): NeckPhotoKind {
  return stringCount === 4 ? 'bass' : 'guitar';
}

/** The profile of the photo the Real guitar view draws a track with `stringCount` strings on. */
export function neckProfileFor(stringCount: number): NeckProfile {
  return neckPhotoKind(stringCount) === 'bass' ? BASS_PROFILE : NECK_PROFILE;
}

/** The profile the pick view draws a track with `stringCount` strings on, when the track is not on the pick view's own guitar photo. */
export function bassPickProfileFor(stringCount: number): NeckProfile | null {
  return neckPhotoKind(stringCount) === 'bass' ? BASS_PICK_PROFILE : null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const finiteList = (v: unknown, min: number): v is number[] => Array.isArray(v) && v.length >= min && v.every(finite);
const increasing = (list: readonly number[]): boolean => list.every((v, i) => i === 0 || v > list[i - 1]);

/** Whether a stored value is a profile the neck view can draw against: every number finite, the wires and knots in order, six strings. */
export function isNeckProfile(value: unknown): value is NeckProfile {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  if (![p.photoWidth, p.photoHeight, p.nutX, p.endX, p.viewStart, p.viewEnd, p.neckRow].every(finite)) return false;
  if ((p.photoWidth as number) <= 0 || (p.photoHeight as number) <= 0 || (p.viewEnd as number) <= (p.viewStart as number)) return false;
  if (!finiteList(p.fretX, 1) || !increasing([p.nutX as number, ...p.fretX])) return false;
  if (!finiteList(p.stringKnotsX, 2) || !increasing(p.stringKnotsX)) return false;
  const knots = p.stringKnotsX.length;
  if (!Array.isArray(p.stringKnotsY) || p.stringKnotsY.length < 2) return false;
  if (!p.stringKnotsY.every((row) => finiteList(row, knots) && row.length === knots)) return false;
  if (!finiteList(p.inlayFrets, 0)) return false;
  return p.pickX === undefined || finite(p.pickX);
}
