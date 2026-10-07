import type { DrawContext } from './draw-context';
import { DEFAULT_LOOKAHEAD, stepsAt, type Step } from './fretboard-steps';
import { emphasisAt } from './emphasis';
import { BEND_REACH, bendSide, cuesAt, SHIVER_HERTZ, SHIVER_REACH, type FingerPose, type NeckCues, type NoteEffect } from './neck-cue-model';
import { drawNeckCues, type NeckSpace } from './neck-cues';
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

/** A stretch of the neck to fill the long side of the screen, in photo pixels: where its middle is and how much it spans. */
export interface NeckWindow {
  readonly centreX: number;
  readonly span: number;
  /** The photo row to centre on; the neck's own row when absent. */
  readonly centreY?: number;
}

/** Where the photo sits on a screen: the neck (or the given stretch of it) fills the long side, and the photo always covers the whole screen. */
export function photoPlacement(width: number, height: number, window?: NeckWindow): PhotoPlacement {
  const rotated = height > width;
  const along = rotated ? height : width;
  const across = rotated ? width : height;
  const span = window ? Math.min(window.span, VIEW_END - VIEW_START) : VIEW_END - VIEW_START;
  const scale = Math.max(along / span, across / PHOTO_HEIGHT);
  const halfAcross = across / (2 * scale);
  const halfSpan = span / 2;
  const centreX = window
    ? Math.min(VIEW_END - halfSpan, Math.max(VIEW_START + halfSpan, window.centreX))
    : (VIEW_START + VIEW_END) / 2;
  return {
    rotated,
    scale,
    centreX,
    centreY: Math.min(PHOTO_HEIGHT - halfAcross, Math.max(halfAcross, window?.centreY ?? NECK_ROW)),
    width,
    height,
  };
}

/** How much of the neck the zoomed view shows along the screen, in photo pixels: roughly the first dozen frets. */
export const ZOOM_SPAN = 480;
/** The zoomed view looks from this long before a moment to this long after it, and glides over that stretch. */
const FOLLOW_BEHIND = 0.6;
const FOLLOW_AHEAD = 2.4;
const FOLLOW_SMOOTHING = [-1, -0.67, -0.33, 0, 0.33, 0.67, 1] as const;

/** The middle of the notes around time `t`: the ones just played and the ones coming up. */
function followTarget(notes: readonly NoteEvent[], t: number): number {
  let sum = 0;
  let count = 0;
  let lastX = (VIEW_START + VIEW_END) / 2;
  let lastStart = -Infinity;
  for (const note of notes) {
    const x = photoNoteX(note.fret);
    if (note.startSeconds <= t && note.startSeconds > lastStart) {
      lastStart = note.startSeconds;
      lastX = x;
    }
    if (note.startSeconds >= t - FOLLOW_BEHIND && note.startSeconds <= t + FOLLOW_AHEAD) {
      sum += x;
      count += 1;
    }
  }
  return count > 0 ? sum / count : lastX;
}

/** Room left around the lowest and highest frets used, in photo pixels (about a fret and a half low down the neck). */
const FIT_MARGIN = 45;
/** The least neck the zoomed view shows, so a song of one or two frets is not blown up past the photo's sharpness. */
const MIN_ZOOM_SPAN = 240;

interface SongRange {
  readonly lowX: number;
  readonly highX: number;
  readonly lowString: number;
  readonly highString: number;
}

const ranges = new WeakMap<readonly NoteEvent[], SongRange | null>();

/** The lowest and highest frets, and the first and last strings, the song uses. */
function songRange(notes: readonly NoteEvent[]): SongRange | null {
  if (ranges.has(notes)) return ranges.get(notes) ?? null;
  let range: SongRange | null = null;
  for (const note of notes) {
    const x = photoNoteX(note.fret);
    range = range
      ? {
          lowX: Math.min(range.lowX, x),
          highX: Math.max(range.highX, x),
          lowString: Math.min(range.lowString, note.string),
          highString: Math.max(range.highString, note.string),
        }
      : { lowX: x, highX: x, lowString: note.string, highString: note.string };
  }
  ranges.set(notes, range);
  return range;
}

/**
 * The zoomed view: the stretch of neck and the strings the song actually uses, so the picture is mostly neck
 * and the notes stay large. When the song covers more neck than reads well at once, a window of that size
 * glides along to follow the notes instead. A pure function of the notes and the time, so exported frames match the screen.
 */
export function zoomedPlacement(
  width: number,
  height: number,
  notes: readonly NoteEvent[],
  t: number,
  stringCount = 6,
): PhotoPlacement {
  const range = songRange(notes);
  if (!range) return photoPlacement(width, height);
  const fitSpan = Math.max(MIN_ZOOM_SPAN, range.highX - range.lowX + 2 * FIT_MARGIN);
  let centreX = (range.lowX + range.highX) / 2;
  let span = fitSpan;
  if (fitSpan > ZOOM_SPAN) {
    span = ZOOM_SPAN;
    let sum = 0;
    for (const offset of FOLLOW_SMOOTHING) sum += followTarget(notes, t + offset);
    centreX = sum / FOLLOW_SMOOTHING.length;
  }
  const centreY = (photoStringY(range.lowString, stringCount, centreX) + photoStringY(range.highString, stringCount, centreX)) / 2;
  return photoPlacement(width, height, { centreX, span, centreY });
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

/** Photo-X of a finger at a fret that may be between whole frets, as it is while a slide carries it. */
export function photoNoteXAt(fret: number): number {
  const low = Math.floor(fret);
  const high = Math.ceil(fret);
  if (low === high) return photoNoteX(low);
  return photoNoteX(low) + (photoNoteX(high) - photoNoteX(low)) * (fret - low);
}

/**
 * Photo pixels a finger at photo-X `x` on `string` is off its string when it is `across` gaps over, positive toward the
 * lower-pitched neighbour. A gap is the distance to the neighbour on that side, or to the other one at the edge of the neck.
 */
function acrossOffset(string: number, stringCount: number, x: number, across: number): number {
  if (across === 0) return 0;
  const toward = string + (across > 0 ? 1 : -1);
  const neighbour = toward >= 1 && toward <= stringCount ? toward : string - (across > 0 ? 1 : -1);
  const gap = neighbour >= 1 && neighbour <= stringCount ? Math.abs(photoStringY(neighbour, stringCount, x) - photoStringY(string, stringCount, x)) : 10;
  return across * gap;
}

/** Ring radius in photo pixels: it follows the gap between frets, which narrows up the neck. */
export function photoRingRadius(fret: number): number {
  const shown = Math.min(Math.max(fret, 1), PHOTO_FRET_COUNT);
  const before = shown === 1 ? NUT_X : FRET_X[shown - 2];
  return Math.max(3.5, Math.min((FRET_X[shown - 1] - before) * 0.36, 6.5));
}

/** Extra drawing calls a surface needs to place the photo; canvases provide these. */
export interface PhotoContext extends DrawContext {
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** The photo of the guitar, placed so the neck fills the screen; plain dark when it is not available yet. */
export function drawNeckPhoto(
  ctx: PhotoContext,
  image: CanvasImageSource | null,
  width: number,
  height: number,
  place: PhotoPlacement = photoPlacement(width, height),
): void {
  ctx.fillStyle = '#03141a';
  ctx.fillRect(0, 0, width, height);
  if (!image) return;
  ctx.save();
  ctx.translate(width / 2, height / 2);
  if (place.rotated) ctx.rotate(Math.PI / 2);
  ctx.scale(place.scale, place.scale);
  ctx.drawImage(image, -place.centreX, -place.centreY);
  ctx.restore();
}

/** One whole frame of the neck view: the photo, then the rings over it. The video export draws each frame through this. */
export function renderNeckFrame(
  ctx: PhotoContext,
  image: CanvasImageSource | null,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: NeckViewOptions = {},
): void {
  const place = options.zoom ? zoomedPlacement(width, height, timeline.notesForTrack(trackIndex), t, timeline.tracks[trackIndex]?.stringCount) : photoPlacement(width, height);
  drawNeckPhoto(ctx, image, width, height, place);
  renderNeckView(ctx, timeline, trackIndex, t, width, height, options);
}

export interface NeckViewOptions {
  readonly theme?: HighwayTheme;
  readonly lookahead?: number;
  readonly labelMode?: LabelMode;
  /** Draw technique cues (arcs, comets, bends, diamonds and the pulse). Absent or false draws the neck as it always was. */
  readonly techniqueCues?: boolean;
  /** Zoom in on the stretch of neck being played and follow it, instead of showing the whole neck. */
  readonly zoom?: boolean;
}

/** Strength of the ring and string of a note a hammer-on or pull-off ends on, which is not picked. */
const UNPICKED_STRENGTH = 0.55;

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
  const place = options.zoom ? zoomedPlacement(width, height, notes, t, stringCount) : photoPlacement(width, height);
  const cues = options.techniqueCues ? cuesAt(notes, t, options.lookahead ?? DEFAULT_LOOKAHEAD, stringCount) : null;
  const poseOf = (note: NoteEvent) => cues?.poses.get(note.id);
  /** A note a hammer-on or pull-off ends on: a softer ring, with no pop. */
  const unpicked = (note: NoteEvent) => cues?.unpicked.has(note.id) ?? false;
  const ringWidth = (note: NoteEvent) => (cues?.effects.get(note.id)?.muted ? 0.6 : 1);

  ctx.save();
  drawDigitalNeck(ctx, place, stringCount);

  drawLitStrings(ctx, place, stringCount, steps.playing, steps.upcoming, theme, t, cues);
  steps.trail.forEach((step, i) => {
    for (const note of step.notes) {
      drawRing(ctx, place, stringCount, note, 0.85, (0.3 - i * 0.08) * (unpicked(note) ? UNPICKED_STRENGTH : 1), theme, naming, false, ringWidth(note), poseOf(note));
    }
  });
  steps.upcoming.forEach((step, i) => {
    for (const note of step.notes) {
      const soft = unpicked(note);
      const grow = soft ? 1 : emphasisAt(note.startSeconds, note.endSeconds, t).scale;
      drawRing(ctx, place, stringCount, note, 0.8 * grow, (0.9 - i * 0.1) * (soft ? UNPICKED_STRENGTH : 1), theme, naming, false, ringWidth(note), poseOf(note));
    }
  });
  if (steps.playing) {
    for (const note of steps.playing.notes) {
      const e = emphasisAt(note.startSeconds, note.endSeconds, t);
      if (unpicked(note)) {
        drawRing(ctx, place, stringCount, note, 1.1, UNPICKED_STRENGTH, theme, naming, false, ringWidth(note), poseOf(note));
        continue;
      }
      if (e.sounding) drawHalo(ctx, place, stringCount, note, e.scale, e.pop, theme, poseOf(note));
      drawRing(ctx, place, stringCount, note, e.scale, 1, theme, naming, true, ringWidth(note), poseOf(note));
    }
  }
  if (cues) drawNeckCues(ctx, neckSpace(place, stringCount, width, height, cues.poses), cues, theme);
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

/** Photo-X at a fret that may fall between two whole frets. */
function fretX(fret: number): number {
  const low = Math.floor(fret);
  const high = Math.ceil(fret);
  const a = photoNoteX(low);
  return a + (photoNoteX(high) - a) * (fret - low);
}

/** The screen positions the technique cues are drawn against. */
function neckSpace(place: PhotoPlacement, stringCount: number, width: number, height: number, poses?: ReadonlyMap<string, FingerPose>): NeckSpace {
  return {
    ring: (note) => markerCentre(place, stringCount, note, poses?.get(note.id)),
    rest: (note) => markerCentre(place, stringCount, note),
    at: (string, fret) => {
      const px = fretX(fret);
      return photoToScreen(place, px, photoStringY(string, stringCount, px));
    },
    scale: place.scale,
    width,
    height,
    stringCount,
  };
}

/** Where a note's ring is on the screen: at its fret and string, or where its finger is while it moves. */
function markerCentre(place: PhotoPlacement, stringCount: number, note: NoteEvent, pose?: FingerPose): { x: number; y: number; r: number } {
  const px = pose ? photoNoteXAt(pose.fret) : photoNoteX(note.fret);
  const py = photoStringY(note.string, stringCount, px) + (pose ? acrossOffset(note.string, stringCount, px, pose.across) : 0);
  return { ...photoToScreen(place, px, py), r: photoRingRadius(note.fret) * place.scale * (pose?.press ?? 1) };
}

/** How far a bending finger stretches its ring along the bend, at a full bend. */
const RING_STRETCH = 0.5;

/** The way a ring is stretched when its finger is pushed across the strings: the angle of the push on the screen and how far, 0 to 1. */
function ringStretch(place: PhotoPlacement, stringCount: number, note: NoteEvent, pose?: FingerPose): { angle: number; amount: number } | null {
  if (!pose || pose.across === 0) return null;
  const pushed = markerCentre(place, stringCount, note, pose);
  const level = markerCentre(place, stringCount, note, { ...pose, across: 0 });
  const dx = pushed.x - level.x;
  const dy = pushed.y - level.y;
  if (Math.hypot(dx, dy) < 1e-9) return null;
  return { angle: Math.atan2(dy, dx), amount: Math.min(1, Math.abs(pose.across) / BEND_REACH) };
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
  cues: NeckCues | null = null,
): void {
  const light = (note: NoteEvent, base: number) => {
    const effect = cues?.effects.get(note.id);
    const pose = cues?.poses.get(note.id);
    const strength = base * (effect?.muted ? MUTED_STRENGTH : 1) * (cues?.unpicked.has(note.id) ? UNPICKED_STRENGTH : 1);
    const from = pose ? photoNoteXAt(pose.fret) : photoNoteX(note.fret);
    const stops = effect && (effect.bend > 0 || effect.shiver > 0) ? sampledStops(from) : [from, ...STRING_KNOTS_X.filter((k) => k > from), BRIDGE_X];
    ctx.strokeStyle = stringColor(theme, note.string);
    for (const [grow, alpha] of [[9, 0.12], [5, 0.22], [2, 0.95]] as const) {
      ctx.globalAlpha = alpha * strength;
      ctx.lineWidth = grow * Math.max(1, place.scale / 2);
      ctx.beginPath();
      stops.forEach((px, i) => {
        const y = photoStringY(note.string, stringCount, px) + stringOffset(effect, note.string, stringCount, px, from, t);
        const at = photoToScreen(place, px, y);
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

/** A lit string drawn at half strength for a palm-muted note. */
const MUTED_STRENGTH = 0.5;
/** Points along a string that bends or shivers, enough to look like a curve. */
const SAMPLES = 24;

function sampledStops(from: number): number[] {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => from + ((BRIDGE_X - from) * i) / SAMPLES);
}

/**
 * How far, in photo pixels, a bent or shivering note's lit string is off the straight line at photo-X `x`. The string leaves the
 * displaced ring and runs straight to the bridge, which does not move, so the offset tapers to nothing there; a vibrato wave
 * travels along it from the ring.
 */
function stringOffset(effect: NoteEffect | undefined, string: number, stringCount: number, x: number, from: number, t: number): number {
  if (!effect || (effect.bend === 0 && effect.shiver === 0)) return 0;
  const taper = 1 - Math.min(1, Math.max(0, (x - from) / Math.max(1, BRIDGE_X - from)));
  const wave = effect.shiver * SHIVER_REACH * Math.sin(2 * Math.PI * SHIVER_HERTZ * t - (x - from) * 0.06);
  const share = (effect.bend * BEND_REACH * bendSide(string, stringCount) + wave) * taper;
  return acrossOffset(string, stringCount, x, share);
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
  pose?: FingerPose,
): void {
  const { x, y, r } = markerCentre(place, stringCount, note, pose);
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
  outline = 1,
  pose?: FingerPose,
): void {
  if (alpha <= 0.02) return;
  const { x, y, r } = markerCentre(place, stringCount, note, pose);
  const radius = r * scale;
  const stretch = ringStretch(place, stringCount, note, pose);
  ctx.beginPath();
  if (stretch) ctx.ellipse(x, y, radius * (1 + RING_STRETCH * stretch.amount), radius, stretch.angle, 0, Math.PI * 2);
  else ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#03141a';
  ctx.globalAlpha = alpha * 0.65;
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = stringColor(theme, note.string);
  ctx.lineWidth = Math.max(1.5, radius * (playing ? 0.16 : 0.12) * outline);
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
