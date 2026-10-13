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
  /** Y of each of the six strings (high e first) at the X positions in `stringKnotsX`; between them the strings run straight. */
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
