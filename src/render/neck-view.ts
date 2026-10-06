import type { DrawContext } from './draw-context';
import { DEFAULT_LOOKAHEAD, stepsAt, type Step } from './fretboard-steps';
import { emphasisAt } from './emphasis';
import { DEFAULT_LABEL_MODE, dotText, type LabelMode } from './fretboard';
import { DEFAULT_THEME, stringColor, type HighwayTheme } from './theme';
import { spellingForTuning } from './note-names';
import type { NoteEvent, Timeline } from '../model/score';

/**
 * The full-screen view draws glowing rings over a photograph of a real guitar neck. Everything here
 * is measured from that photo (`guitar-photo.jpg`, 1120 by 491, headstock on the left), in the
 * photo's own pixels, so the rings land on its frets and strings.
 */
export const PHOTO_WIDTH = 1120;
export const PHOTO_HEIGHT = 491;

/** X of the nut, then of each fret wire from fret 1 to fret 24. */
const NUT_X = 137;
const FRET_X = [181, 222, 262, 302, 339, 373, 408, 441, 472, 502, 531, 558, 584, 609, 633, 656, 677, 699, 720, 738, 755, 772, 790, 804] as const;
export const PHOTO_FRET_COUNT = FRET_X.length;
/** X of the bridge, where the strings end. */
const BRIDGE_X = 1095;

/** Y of each of the six strings (high e first) at these X positions; between them the strings run straight. */
const STRING_KNOTS_X = [145, 300, 500, 600, 700, 800] as const;
const STRING_KNOTS_Y: readonly (readonly number[])[] = [
  [208, 210, 214, 215, 217, 218],
  [217, 221, 226, 229, 231, 233],
  [226, 231, 238, 242, 245, 248],
  [236, 242, 251, 255, 259, 264],
  [245, 253, 264, 269, 274, 279],
  [255, 264, 276, 282, 288, 294],
];

/** The stretch of the photo the view shows (the headstock to the last frets) and the row the neck runs along. */
const VIEW_START = 20;
const VIEW_END = 820;
const NECK_ROW = 262;

export interface PhotoPlacement {
  /** True on a tall screen: the photo is turned so the headstock is at the top, like a guitar held up. */
  readonly rotated: boolean;
  /** Screen pixels per photo pixel. */
  readonly scale: number;
  /** The photo point shown at the middle of the screen. */
  readonly centreX: number;
  readonly centreY: number;
  readonly width: number;
  readonly height: number;
}

/** Where the photo sits on a screen: the neck fills the long side, and the photo always covers the whole screen. */
export function photoPlacement(width: number, height: number): PhotoPlacement {
  const rotated = height > width;
  const along = rotated ? height : width;
  const across = rotated ? width : height;
  const scale = Math.max(along / (VIEW_END - VIEW_START), across / PHOTO_HEIGHT);
  const halfAcross = across / (2 * scale);
  return {
    rotated,
    scale,
    centreX: (VIEW_START + VIEW_END) / 2,
    centreY: Math.min(PHOTO_HEIGHT - halfAcross, Math.max(halfAcross, NECK_ROW)),
    width,
    height,
  };
}

/** Where a photo point lands on the screen. */
export function photoToScreen(place: PhotoPlacement, px: number, py: number): { x: number; y: number } {
  const along = (px - place.centreX) * place.scale;
  const across = (py - place.centreY) * place.scale;
  return place.rotated
    ? { x: place.width / 2 - across, y: place.height / 2 + along }
    : { x: place.width / 2 + along, y: place.height / 2 + across };
}

/** Y of a string in the photo at photo-X `x`; strings beyond the six are spread between the outer two. */
export function photoStringY(string: number, stringCount: number, x: number): number {
  const at = stringCount > 1 ? ((string - 1) / (stringCount - 1)) * 5 : 2.5;
  const low = Math.min(4, Math.floor(at));
  const mix = at - low;
  return lineAt(STRING_KNOTS_Y[low], x) * (1 - mix) + lineAt(STRING_KNOTS_Y[low + 1], x) * mix;
}

/** Straight-line value through the knots, carried on past both ends at the end slopes. */
function lineAt(ys: readonly number[], x: number): number {
  const xs = STRING_KNOTS_X;
  const last = xs.length - 1;
  const i = x <= xs[0] ? 0 : x >= xs[last] ? last - 1 : xs.findIndex((k, n) => n < last && x >= k && x < xs[n + 1]);
  const slope = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + slope * (x - xs[i]);
}

/** Photo-X of a note's ring: between its fret wires, or just behind the nut for an open string. */
export function photoNoteX(fret: number): number {
  if (fret <= 0) return NUT_X - 14;
  const shown = Math.min(fret, PHOTO_FRET_COUNT);
  const before = shown === 1 ? NUT_X : FRET_X[shown - 2];
  return (before + FRET_X[shown - 1]) / 2;
}

/** Ring radius in photo pixels: it follows the gap between frets, which narrows up the neck. */
export function photoRingRadius(fret: number): number {
  const shown = Math.min(Math.max(fret, 1), PHOTO_FRET_COUNT);
  const before = shown === 1 ? NUT_X : FRET_X[shown - 2];
  return Math.max(3.5, Math.min((FRET_X[shown - 1] - before) * 0.36, 6.5));
}

export interface NeckViewOptions {
  readonly theme?: HighwayTheme;
  readonly lookahead?: number;
  readonly labelMode?: LabelMode;
}

interface Naming {
  readonly mode: LabelMode;
  readonly tuning: readonly number[];
  readonly spelling: ReturnType<typeof spellingForTuning>;
}

/**
 * Draws the rings for one track at time `t` over the photograph: a thin glowing ring where to play,
 * and the string lit in the note's colour from there to the bridge. The caller draws the photo first,
 * using `photoPlacement`; this dims and tidies it a little. A pure function of its arguments, like the other views.
 */
export function renderNeckView(
  ctx: DrawContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: NeckViewOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_THEME;
  const notes = timeline.notesForTrack(trackIndex);
  const stringCount = timeline.tracks[trackIndex]?.stringCount ?? 6;
  const steps = stepsAt(notes, t, options.lookahead ?? DEFAULT_LOOKAHEAD);
  const tuning = timeline.tracks[trackIndex]?.tuning ?? [];
  const naming: Naming = { mode: options.labelMode ?? DEFAULT_LABEL_MODE, tuning, spelling: spellingForTuning(tuning) };
  const place = photoPlacement(width, height);

  ctx.save();
  drawDigitalNeck(ctx, place, stringCount);

  drawLitStrings(ctx, place, stringCount, steps.playing, steps.upcoming, theme, t);
  steps.trail.forEach((step, i) => {
    for (const note of step.notes) drawRing(ctx, place, stringCount, note, 0.85, 0.3 - i * 0.08, theme, naming, false);
  });
  steps.upcoming.forEach((step, i) => {
    for (const note of step.notes) {
      const grow = emphasisAt(note.startSeconds, note.endSeconds, t).scale;
      drawRing(ctx, place, stringCount, note, 0.8 * grow, 0.9 - i * 0.1, theme, naming, false);
    }
  });
  if (steps.playing) {
    for (const note of steps.playing.notes) {
      const e = emphasisAt(note.startSeconds, note.endSeconds, t);
      if (e.sounding) drawHalo(ctx, place, stringCount, note, e.scale, e.pop, theme);
      drawRing(ctx, place, stringCount, note, e.scale, 1, theme, naming, true);
    }
  }
  ctx.restore();
}

/** Photo-Y of the board's top and bottom edges at photo-X `x`, a little outside the outer strings. */
const boardTop = (x: number) => photoStringY(1, 6, x) - 6;
const boardBottom = (x: number) => photoStringY(6, 6, x) + 7;
const BOARD_LEFT = NUT_X - 2;
const BOARD_RIGHT = FRET_X[PHOTO_FRET_COUNT - 1] + 6;
const FAR = 5000;
const FRET_NUMBERS: readonly number[] = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
const GLASS = '#9fe8ff';

/** Fills a polygon given in photo coordinates. */
function fillPhotoPolygon(ctx: DrawContext, place: PhotoPlacement, points: readonly (readonly [number, number])[]): void {
  ctx.beginPath();
  points.forEach(([px, py], i) => {
    const at = photoToScreen(place, px, py);
    if (i === 0) ctx.moveTo(at.x, at.y);
    else ctx.lineTo(at.x, at.y);
  });
  ctx.closePath();
  ctx.fill();
}

/**
 * A light digital treatment of the photo: everything but the fretboard is dimmed, the board gets a
 * faint cool tint, and crisp fret lines, string lines and fret numbers are drawn over the real ones.
 */
function drawDigitalNeck(ctx: DrawContext, place: PhotoPlacement, stringCount: number): void {
  const edge = [BOARD_LEFT, ...STRING_KNOTS_X.filter((k) => k > BOARD_LEFT && k < BOARD_RIGHT), BOARD_RIGHT];
  const topEdge = edge.map((x) => [x, boardTop(x)] as const);
  const bottomEdge = edge.map((x) => [x, boardBottom(x)] as const);

  // dim the table, the headstock and the body
  ctx.fillStyle = '#020b0f';
  ctx.globalAlpha = 0.62;
  fillPhotoPolygon(ctx, place, [[-FAR, -FAR], [BOARD_LEFT, -FAR], [BOARD_LEFT, FAR], [-FAR, FAR]]);
  fillPhotoPolygon(ctx, place, [[BOARD_RIGHT, -FAR], [FAR, -FAR], [FAR, FAR], [BOARD_RIGHT, FAR]]);
  fillPhotoPolygon(ctx, place, [[BOARD_LEFT, -FAR], [BOARD_RIGHT, -FAR], ...[...topEdge].reverse()]);
  fillPhotoPolygon(ctx, place, [[BOARD_LEFT, FAR], [BOARD_RIGHT, FAR], ...[...bottomEdge].reverse()]);
  // the board itself: a slight cool tint and a little shade so the lit strings stand out
  ctx.fillStyle = '#052a33';
  ctx.globalAlpha = 0.22;
  fillPhotoPolygon(ctx, place, [...topEdge, ...[...bottomEdge].reverse()]);

  // crisp fret wires, the nut a little brighter
  ctx.strokeStyle = GLASS;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const a = photoToScreen(place, x0, y0);
    const b = photoToScreen(place, x1, y1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const px = Math.max(1, place.scale * 0.5);
  [NUT_X, ...FRET_X].forEach((x, i) => {
    ctx.globalAlpha = i === 0 ? 0.7 : 0.38;
    ctx.lineWidth = i === 0 ? px * 2.4 : px * 1.1;
    line(x, boardTop(x), x, boardBottom(x));
  });

  // thin string lines from the nut to the last fret
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = px * 0.8;
  for (let s = 1; s <= stringCount; s++) {
    line(NUT_X, photoStringY(s, stringCount, NUT_X), BOARD_RIGHT, photoStringY(s, stringCount, BOARD_RIGHT));
  }

  // fret numbers just under the board, at the frets that carry inlays
  ctx.fillStyle = GLASS;
  ctx.globalAlpha = 0.75;
  ctx.font = `${Math.max(10, Math.round(place.scale * 6))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const fret of FRET_NUMBERS) {
    const x = photoNoteX(fret);
    const at = photoToScreen(place, x, boardBottom(x) + 11);
    ctx.fillText(String(fret), at.x, at.y);
  }
  ctx.globalAlpha = 1;
}

function markerCentre(place: PhotoPlacement, stringCount: number, note: NoteEvent): { x: number; y: number; r: number } {
  const px = photoNoteX(note.fret);
  const at = photoToScreen(place, px, photoStringY(note.string, stringCount, px));
  return { ...at, r: photoRingRadius(note.fret) * place.scale };
}

/** The string lit from a note's ring to the bridge: a soft wide glow under a bright core. */
function drawLitStrings(
  ctx: DrawContext,
  place: PhotoPlacement,
  stringCount: number,
  playing: Step | null,
  upcoming: readonly Step[],
  theme: HighwayTheme,
  t: number,
): void {
  const light = (note: NoteEvent, strength: number) => {
    const from = photoNoteX(note.fret);
    const stops = [from, ...STRING_KNOTS_X.filter((k) => k > from), BRIDGE_X];
    ctx.strokeStyle = stringColor(theme, note.string);
    for (const [grow, alpha] of [[9, 0.12], [5, 0.22], [2, 0.95]] as const) {
      ctx.globalAlpha = alpha * strength;
      ctx.lineWidth = grow * Math.max(1, place.scale / 2);
      ctx.beginPath();
      stops.forEach((px, i) => {
        const at = photoToScreen(place, px, photoStringY(note.string, stringCount, px));
        if (i === 0) ctx.moveTo(at.x, at.y);
        else ctx.lineTo(at.x, at.y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  upcoming.forEach((step, i) => {
    for (const note of step.notes) light(note, Math.max(0, 0.3 - i * 0.07));
  });
  if (playing) {
    for (const note of playing.notes) light(note, emphasisAt(note.startSeconds, note.endSeconds, t).sounding ? 1 : 0.5);
  }
}

/** A soft pair of rings around the note being played; wider right at its start. */
function drawHalo(
  ctx: DrawContext,
  place: PhotoPlacement,
  stringCount: number,
  note: NoteEvent,
  scale: number,
  pop: number,
  theme: HighwayTheme,
): void {
  const { x, y, r } = markerCentre(place, stringCount, note);
  ctx.strokeStyle = stringColor(theme, note.string);
  for (const [extra, alpha, width] of [[9 + 12 * pop, 0.14, 7], [4 + 6 * pop, 0.3, 3]] as const) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r * scale + extra, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A thin glowing ring around a dark centre, with its label when it is big enough to read. */
function drawRing(
  ctx: DrawContext,
  place: PhotoPlacement,
  stringCount: number,
  note: NoteEvent,
  scale: number,
  alpha: number,
  theme: HighwayTheme,
  naming: Naming,
  playing: boolean,
): void {
  if (alpha <= 0.02) return;
  const { x, y, r } = markerCentre(place, stringCount, note);
  const radius = r * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#03141a';
  ctx.globalAlpha = alpha * 0.65;
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = stringColor(theme, note.string);
  ctx.lineWidth = Math.max(1.5, radius * (playing ? 0.16 : 0.12));
  ctx.stroke();
  if (radius >= 8) {
    const text = dotText(note, naming);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(radius * 0.95)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.main, x, y);
  }
  ctx.globalAlpha = 1;
}
