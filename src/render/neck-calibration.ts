import type { NeckProfile } from './neck-profile';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The seven taps, in the order they are asked for. Each pair is the high-e string then the low-E string, where it crosses the
 * nut, the 12th fret wire and the last fret wire; the last tap is where the pick lands on the strings.
 */
export interface CalibrationTaps {
  readonly nut: readonly [Point, Point];
  readonly twelfth: readonly [Point, Point];
  readonly last: readonly [Point, Point];
  readonly pick: Point;
}

/** One prompt per tap, in the order the taps are taken: the pairs are high-e first, and the pick point last. */
export const TAP_PROMPTS: readonly string[] = [
  'Tap the high e string where it crosses the nut',
  'Tap the low E string where it crosses the nut',
  'Tap the high e string on the 12th fret wire',
  'Tap the low E string on the 12th fret wire',
  'Tap the high e string on the last fret wire',
  'Tap the low E string on the last fret wire',
  'Tap where the pick lands on the strings, on the body',
];

/** How the photo is turned and cut for the neck view: rotate about its centre, then take the box that holds the whole turned photo. */
export interface NormalizeSpec {
  /** Radians the photo is turned by so the neck runs left to right with the headstock on the left. */
  readonly angle: number;
  readonly centre: Point;
  /** The turned photo's top-left corner in the turned frame, and its size, in the photo's own pixels. */
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
  /** Profile units per pixel of the turned photo. */
  readonly unitsPerPixel: number;
}

export type CalibrationResult = { readonly ok: true; readonly profile: NeckProfile; readonly normalize: NormalizeSpec } | { readonly ok: false; readonly reason: string };

/** The frets a player can say the neck has. */
export const MIN_FRETS = 18;
export const MAX_FRETS = 27;
/** Profile units from the nut to the bridge, so a calibrated photo is drawn at the same size as the bundled ones. */
const SCALE_UNITS = 920;
/** The frets that carry an inlay, on a neck that has them. */
const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];

/** Share of the scale length from the nut to fret `n`, by the equal-temperament rule. */
const share = (n: number): number => 1 - Math.pow(2, -n / 12);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const fail = (reason: string): CalibrationResult => ({ ok: false, reason });

/** Least-squares straight line y = m x + b through the points. */
function fitLine(points: readonly Point[]): (x: number) => number {
  const n = points.length;
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  const m = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return (x) => m * x + b;
}

/**
 * Fits a neck profile from the seven taps. The photo is first turned so the nut-to-last-fret line runs left to right; in that frame the
 * wires follow a one-dimensional projective map through the nut, the 12th fret and the last fret (which is how frets bunch up on an
 * angled photo), and each string side is a straight line through its three taps. Rejects taps that cannot describe a neck, saying why.
 */
export function calibrate(input: { taps: CalibrationTaps; fretCount: number; photoWidth: number; photoHeight: number }): CalibrationResult {
  const { taps, fretCount, photoWidth, photoHeight } = input;
  if (!Number.isInteger(fretCount) || fretCount < MIN_FRETS || fretCount > MAX_FRETS) return fail(`Say how many frets the neck has, from ${MIN_FRETS} to ${MAX_FRETS}.`);

  const nutMid = mid(taps.nut[0], taps.nut[1]);
  const lastMid = mid(taps.last[0], taps.last[1]);
  const length = Math.hypot(lastMid.x - nutMid.x, lastMid.y - nutMid.y);
  if (length < 20) return fail('The nut and the last fret are on top of each other. Tap them on opposite ends of the neck.');

  const angle = -Math.atan2(lastMid.y - nutMid.y, lastMid.x - nutMid.x);
  const centre = { x: photoWidth / 2, y: photoHeight / 2 };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const turn = (p: Point): Point => ({ x: cos * (p.x - centre.x) - sin * (p.y - centre.y), y: sin * (p.x - centre.x) + cos * (p.y - centre.y) });

  const [nutTop, nutBottom] = [turn(taps.nut[0]), turn(taps.nut[1])];
  const [twTop, twBottom] = [turn(taps.twelfth[0]), turn(taps.twelfth[1])];
  const [lastTop, lastBottom] = [turn(taps.last[0]), turn(taps.last[1])];
  const pick = turn(taps.pick);
  const xN = (nutTop.x + nutBottom.x) / 2;
  const x12 = (twTop.x + twBottom.x) / 2;
  const xL = (lastTop.x + lastBottom.x) / 2;
  if (!(xN < x12 && x12 < xL)) return fail('The 12th fret must be between the nut and the last fret.');

  for (const [top, bottom] of [[nutTop, nutBottom], [twTop, twBottom], [lastTop, lastBottom]] as const) {
    if (bottom.y - top.y < 4) return fail('The high e string tap must be above the low E string tap once the neck is turned with the headstock on the left.');
  }

  // frets: x(s) = xN + A s / (1 + C s) through the 12th fret (s = 0.5) and the last fret
  const sLast = share(fretCount);
  const d1 = x12 - xN;
  const d2 = xL - xN;
  const denominator = sLast * (d2 - d1);
  if (Math.abs(denominator) < 1e-9) return fail('The 12th fret and the last fret are in a place that no neck has them.');
  const C = (2 * d1 * sLast - d2) / denominator;
  const A = d1 * (2 + C);
  if (1 + C <= 0.05) return fail('The frets bunch up too sharply to fit. Try a photo taken from more above the neck.');
  const wireX = (n: number) => xN + (A * share(n)) / (1 + C * share(n));
  const wires = Array.from({ length: fretCount }, (_, i) => wireX(i + 1));
  if (!wires.every((x, i) => x > (i === 0 ? xN : wires[i - 1]))) return fail('The frets do not run in order along the neck from those taps.');

  // string sides: straight lines through their three taps
  const top = fitLine([nutTop, twTop, lastTop]);
  const bottom = fitLine([nutBottom, twBottom, lastBottom]);
  const knotsX = [xN, x12, xL];

  if (!(pick.x > xL + 4)) return fail('Tap the pick point past the last fret, on the body.');

  // the turned photo's box, and the units it is drawn in
  const corners = [turn({ x: 0, y: 0 }), turn({ x: photoWidth, y: 0 }), turn({ x: 0, y: photoHeight }), turn({ x: photoWidth, y: photoHeight })];
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const width = Math.max(...corners.map((c) => c.x)) - minX;
  const height = Math.max(...corners.map((c) => c.y)) - minY;
  const k = SCALE_UNITS / (length / sLast);
  const ux = (x: number) => (x - minX) * k;
  const uy = (y: number) => (y - minY) * k;
  const unitsWidth = width * k;
  if (!(pick.x < minX + width - 4) || ux(wires[wires.length - 1]) >= unitsWidth) return fail('The frets or the pick point are outside the photo.');

  const stringsAt = (x: number) => [0, 1, 2, 3, 4, 5].map((i) => uy(top(x) + ((bottom(x) - top(x)) * i) / 5));
  const rows = knotsX.map((x) => stringsAt(x));
  const stringKnotsY = [0, 1, 2, 3, 4, 5].map((s) => rows.map((row) => row[s]));
  const pickX = ux(pick.x);

  const profile: NeckProfile = {
    photoWidth: unitsWidth,
    photoHeight: height * k,
    nutX: ux(xN),
    fretX: wires.map(ux),
    endX: unitsWidth,
    stringKnotsX: knotsX.map(ux),
    stringKnotsY,
    viewStart: Math.max(0, ux(xN) - 114),
    viewEnd: Math.min(unitsWidth, pickX + 60),
    neckRow: uy((top(x12) + bottom(x12)) / 2),
    inlayFrets: INLAYS.filter((n) => n <= fretCount),
    pickX,
  };
  return { ok: true, profile, normalize: { angle, centre, minX, minY, width, height, unitsPerPixel: k } };
}

/**
 * Where a tap at client position `at` lands on a photo drawn to fit inside `rect`, in the photo's own pixels, or null when it is in the
 * margin around the photo.
 */
export function tapToPhoto(at: Point, rect: { left: number; top: number; width: number; height: number }, photo: { width: number; height: number }): Point | null {
  const scale = Math.min(rect.width / photo.width, rect.height / photo.height);
  const drawnWidth = photo.width * scale;
  const drawnHeight = photo.height * scale;
  const x = (at.x - rect.left - (rect.width - drawnWidth) / 2) / scale + 0;
  const y = (at.y - rect.top - (rect.height - drawnHeight) / 2) / scale + 0;
  if (x < 0 || y < 0 || x > photo.width || y > photo.height) return null;
  return { x, y };
}
