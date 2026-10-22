import type { DrawContext } from './draw-context';
import { NECK_PROFILE, type NeckProfile } from './neck-profile';
import { type Step } from './fretboard-steps';
import { momentAt, type Moment } from './moment';
import { emphasisAt } from './emphasis';
import { BEND_REACH, bendSide, cuesAt, SHIVER_HERTZ, SHIVER_REACH, type FingerPose, type NeckCues, type NoteEffect } from './neck-cue-model';
import { drawNeckCues, type NeckSpace } from './neck-cues';
import { DEFAULT_LABEL_MODE, dotText, type LabelMode } from './fretboard';
import { pickAt, pickPlan, type PickState } from './pick-cues';
import { DEFAULT_THEME, stringColor, type HighwayTheme } from './theme';
import { spellingForTuning } from './note-names';
import type { NoteEvent, Timeline } from '../model/score';

/**
 * The full-screen view draws glowing rings over a photograph of a real guitar neck. Everything it draws against is
 * measured from that photo and held in a `NeckProfile` (headstock on the left), in the photo's own pixels, so the rings land on
 * its frets and strings. Without a profile argument the Real guitar view's photo is used.
 */
export const PHOTO_WIDTH = NECK_PROFILE.photoWidth;
export const PHOTO_HEIGHT = NECK_PROFILE.photoHeight;
export const PHOTO_FRET_COUNT = NECK_PROFILE.fretX.length;

export interface PhotoPlacement {
  /** The profile of the photo being drawn against. */
  readonly profile: NeckProfile;
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
export function photoPlacement(width: number, height: number, window?: NeckWindow, profile: NeckProfile = NECK_PROFILE): PhotoPlacement {
  const rotated = height > width;
  const along = rotated ? height : width;
  const across = rotated ? width : height;
  const { viewStart, viewEnd } = profile;
  const span = window ? Math.min(window.span, viewEnd - viewStart) : viewEnd - viewStart;
  const scale = Math.max(along / span, across / profile.photoHeight);
  const halfAcross = across / (2 * scale);
  const halfSpan = span / 2;
  const centreX = window
    ? Math.min(viewEnd - halfSpan, Math.max(viewStart + halfSpan, window.centreX))
    : (viewStart + viewEnd) / 2;
  return {
    profile,
    rotated,
    scale,
    centreX,
    centreY: Math.min(profile.photoHeight - halfAcross, Math.max(halfAcross, window?.centreY ?? profile.neckRow)),
    width,
    height,
  };
}

/** How much of the neck the zoomed view shows along the screen while following, in photo pixels: roughly the first dozen frets. It never changes, so the zoom does not breathe. */
export const ZOOM_SPAN = 480;
/** The camera holds still through a bar and only moves when the next bar's middle is at least this far (photo pixels, about two frets low down the neck) from where it already sits. */
export const CAMERA_MOVE_MIN = 60;
/** A bar of only harmonics or slides moves the camera only for a shift this big (photo pixels, about five frets low down the neck): those notes are easy to follow without a closer look. */
export const CAMERA_LOOSE_MOVE_MIN = 150;
/** A move starts this long before the new bar's first note and takes this long; it eases in and out and never overshoots. */
const GLIDE_LEAD = 0.25;
const GLIDE_SECONDS = 0.6;

/**
 * How much a note should pull the camera. Muted (x) and open-string notes never do: they sit off the stretch being fretted and
 * are shown as symbols instead. Harmonics and slides pull only when a bar has nothing fretted, and then only for a big shift.
 */
function cameraPull(note: NoteEvent): 'none' | 'loose' | 'firm' {
  if (note.techniques.dead || note.fret <= 0) return 'none';
  if (note.techniques.harmonic || note.techniques.slide !== 'none') return 'loose';
  return 'firm';
}

interface CameraMove {
  readonly start: number;
  readonly from: number;
  readonly to: number;
}

interface CameraPath {
  readonly first: number;
  readonly moves: readonly CameraMove[];
}

/** The camera's centre at `t`: the latest move to have started, part of the way along its glide, or the first frame before any. */
function centreAt(first: number, moves: readonly CameraMove[], t: number): number {
  for (let i = moves.length - 1; i >= 0; i--) {
    const move = moves[i];
    if (t < move.start) continue;
    const u = Math.min(1, (t - move.start) / GLIDE_SECONDS);
    return move.from + (move.to - move.from) * (u * u * (3 - 2 * u));
  }
  return first;
}

const paths = new WeakMap<readonly NoteEvent[], Map<NeckProfile, CameraPath>>();

/**
 * The camera over the whole song, one frame per played bar: the middle of the frets that bar uses. It holds that frame for the
 * whole bar and glides to the next bar's frame only when it is clearly somewhere else, so alternating nearby positions never
 * rock it. Played-bar order means a repeated section frames the same each time. Built from the notes alone, so exported frames match the screen.
 */
function cameraPath(notes: readonly NoteEvent[], profile: NeckProfile): CameraPath {
  const cached = paths.get(notes)?.get(profile);
  if (cached) return cached;
  interface Reach {
    low: number;
    high: number;
    start: number;
  }
  const bars = new Map<number, { firm?: Reach; loose?: Reach }>();
  for (const note of notes) {
    const pull = cameraPull(note);
    if (pull === 'none') continue;
    const x = photoNoteX(note.fret, profile);
    const bar = bars.get(note.playbackBar) ?? {};
    bars.set(note.playbackBar, bar);
    const reach = bar[pull];
    if (!reach) bar[pull] = { low: x, high: x, start: note.startSeconds };
    else {
      reach.low = Math.min(reach.low, x);
      reach.high = Math.max(reach.high, x);
      reach.start = Math.min(reach.start, note.startSeconds);
    }
  }
  const frames = [...bars.values()]
    .map((bar) => (bar.firm ? { ...bar.firm, min: CAMERA_MOVE_MIN } : bar.loose ? { ...bar.loose, min: CAMERA_LOOSE_MOVE_MIN } : null))
    .filter((frame): frame is Reach & { min: number } => frame !== null)
    .sort((p, q) => p.start - q.start);
  const moves: CameraMove[] = [];
  let first = 0;
  if (frames.length > 0) {
    first = (frames[0].low + frames[0].high) / 2;
    let held = first;
    for (const frame of frames.slice(1)) {
      const centre = (frame.low + frame.high) / 2;
      if (Math.abs(centre - held) < frame.min) continue;
      // A move that comes due while the last is still gliding sets off from wherever the camera has got to, so quick shifts never queue up.
      const start = frame.start - GLIDE_LEAD;
      moves.push({ start, from: centreAt(first, moves, start), to: centre });
      held = centre;
    }
  }
  const path = { first, moves };
  const byProfile = paths.get(notes) ?? new Map<NeckProfile, CameraPath>();
  byProfile.set(profile, path);
  paths.set(notes, byProfile);
  return path;
}

/** Where the following camera is centred at time `t`. */
function followCentre(notes: readonly NoteEvent[], t: number, profile: NeckProfile): number {
  const { first, moves } = cameraPath(notes, profile);
  return centreAt(first, moves, t);
}

/** Room left around the lowest and highest frets used, in photo pixels (about a fret and a half low down the neck). */
const FIT_MARGIN = 45;
/** Room kept past the pick point, in photo pixels, when the view frames it. */
const PICK_MARGIN = 30;
/** The least neck the zoomed view shows, so a song of one or two frets is not blown up past the photo's sharpness. */
const MIN_ZOOM_SPAN = 240;

interface SongRange {
  readonly lowX: number;
  readonly highX: number;
  readonly lowString: number;
  readonly highString: number;
}

const ranges = new WeakMap<readonly NoteEvent[], Map<NeckProfile, SongRange | null>>();

/** The lowest and highest frets the camera frames, and the first and last strings, the song uses. Muted and open notes do not stretch the frets; they only count when nothing else is played. */
function songRange(notes: readonly NoteEvent[], profile: NeckProfile): SongRange | null {
  const cachedRange = ranges.get(notes);
  if (cachedRange?.has(profile)) return cachedRange.get(profile) ?? null;
  const pulls = notes.map(cameraPull);
  const best = pulls.includes('firm') ? 'firm' : pulls.includes('loose') ? 'loose' : null;
  let lowX = Infinity;
  let highX = -Infinity;
  let lowString = Infinity;
  let highString = -Infinity;
  notes.forEach((note, i) => {
    lowString = Math.min(lowString, note.string);
    highString = Math.max(highString, note.string);
    if (best !== null && pulls[i] !== best) return;
    const x = photoNoteX(note.fret, profile);
    lowX = Math.min(lowX, x);
    highX = Math.max(highX, x);
  });
  const range: SongRange | null = notes.length > 0 ? { lowX, highX, lowString, highString } : null;
  const byProfile = cachedRange ?? new Map<NeckProfile, SongRange | null>();
  byProfile.set(profile, range);
  ranges.set(notes, byProfile);
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
  profile: NeckProfile = NECK_PROFILE,
): PhotoPlacement {
  const range = songRange(notes, profile);
  if (!range) return photoPlacement(width, height, undefined, profile);
  const fitSpan = Math.max(MIN_ZOOM_SPAN, range.highX - range.lowX + 2 * FIT_MARGIN);
  let centreX = (range.lowX + range.highX) / 2;
  let span = fitSpan;
  if (fitSpan > ZOOM_SPAN) {
    centreX = followCentre(notes, t, profile);
    span = ZOOM_SPAN;
  }
  if (profile.pickX !== undefined) {
    // take in the pick point as well: the window grows to the right until it holds it, so it glides as smoothly as the camera does
    const low = centreX - span / 2;
    const high = Math.max(centreX + span / 2, profile.pickX + PICK_MARGIN);
    centreX = (low + high) / 2;
    span = high - low;
  }
  const centreY = (photoStringY(range.lowString, stringCount, centreX, profile) + photoStringY(range.highString, stringCount, centreX, profile)) / 2;
  return photoPlacement(width, height, { centreX, span, centreY }, profile);
}

/** Where a photo point lands on the screen. */
export function photoToScreen(place: PhotoPlacement, px: number, py: number): { x: number; y: number } {
  const along = (px - place.centreX) * place.scale;
  const across = (py - place.centreY) * place.scale;
  return place.rotated
    ? { x: place.width / 2 - across, y: place.height / 2 + along }
    : { x: place.width / 2 + along, y: place.height / 2 + across };
}

/** Y of a string in the photo at photo-X `x`; a track with more or fewer strings than the photo shows is spread between the outer two. */
export function photoStringY(string: number, stringCount: number, x: number, profile: NeckProfile = NECK_PROFILE): number {
  const gaps = profile.stringKnotsY.length - 1;
  const at = stringCount > 1 ? ((string - 1) / (stringCount - 1)) * gaps : gaps / 2;
  const low = Math.min(gaps - 1, Math.floor(at));
  const mix = at - low;
  return lineAt(profile.stringKnotsY[low], profile.stringKnotsX, x) * (1 - mix) + lineAt(profile.stringKnotsY[low + 1], profile.stringKnotsX, x) * mix;
}

/** Straight-line value through the knots, carried on past both ends at the end slopes. */
function lineAt(ys: readonly number[], xs: readonly number[], x: number): number {
  const last = xs.length - 1;
  const i = x <= xs[0] ? 0 : x >= xs[last] ? last - 1 : xs.findIndex((k, n) => n < last && x >= k && x < xs[n + 1]);
  const slope = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + slope * (x - xs[i]);
}

/** Photo-X of a note's ring: between its fret wires, or just behind the nut for an open string. */
export function photoNoteX(fret: number, profile: NeckProfile = NECK_PROFILE): number {
  const { nutX, fretX } = profile;
  if (fret <= 0) return nutX - 14;
  const shown = Math.min(fret, fretX.length);
  const before = shown === 1 ? nutX : fretX[shown - 2];
  return (before + fretX[shown - 1]) / 2;
}

/** Photo-X of a finger at a fret that may be between whole frets, as it is while a slide carries it. */
export function photoNoteXAt(fret: number, profile: NeckProfile = NECK_PROFILE): number {
  const low = Math.floor(fret);
  const high = Math.ceil(fret);
  if (low === high) return photoNoteX(low, profile);
  return photoNoteX(low, profile) + (photoNoteX(high, profile) - photoNoteX(low, profile)) * (fret - low);
}

/**
 * Photo pixels a finger at photo-X `x` on `string` is off its string when it is `across` gaps over, positive toward the
 * lower-pitched neighbour. A gap is the distance to the neighbour on that side, or to the other one at the edge of the neck.
 */
function acrossOffset(string: number, stringCount: number, x: number, across: number, profile: NeckProfile): number {
  if (across === 0) return 0;
  const toward = string + (across > 0 ? 1 : -1);
  const neighbour = toward >= 1 && toward <= stringCount ? toward : string - (across > 0 ? 1 : -1);
  const gap = neighbour >= 1 && neighbour <= stringCount ? Math.abs(photoStringY(neighbour, stringCount, x, profile) - photoStringY(string, stringCount, x, profile)) : 10;
  return across * gap;
}

/** Ring radius in photo pixels: it follows the gap between frets, which narrows up the neck. */
export function photoRingRadius(fret: number, profile: NeckProfile = NECK_PROFILE): number {
  const { nutX, fretX } = profile;
  const shown = Math.min(Math.max(fret, 1), fretX.length);
  const before = shown === 1 ? nutX : fretX[shown - 2];
  return Math.max(3.5, Math.min((fretX[shown - 1] - before) * 0.36, 6.5));
}

/** Extra drawing calls a surface needs to place the photo; canvases provide these. */
export interface PhotoContext extends DrawContext {
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  drawImage(image: CanvasImageSource, x: number, y: number, width: number, height: number): void;
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
  ctx.drawImage(image, -place.centreX, -place.centreY, place.profile.photoWidth, place.profile.photoHeight);
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
  const profile = options.profile ?? NECK_PROFILE;
  const place = options.zoom
    ? zoomedPlacement(width, height, timeline.notesForTrack(trackIndex), t, timeline.tracks[trackIndex]?.stringCount, profile)
    : photoPlacement(width, height, undefined, profile);
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
  /** The photo's profile; the Real guitar view's when absent. */
  readonly profile?: NeckProfile;
  /** The frame's shared moment; built from the timeline, time and `lookahead` when absent. */
  readonly moment?: Moment;
}

/** Strength of the ring and string of a note a hammer-on or pull-off ends on, which is not picked. */
const UNPICKED_STRENGTH = 0.55;

interface Naming {
  readonly mode: LabelMode;
  readonly tuning: readonly number[];
  readonly capo?: number;
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
  const moment = options.moment ?? momentAt(timeline, trackIndex, t, { lookahead: options.lookahead });
  const tuning = timeline.tracks[trackIndex]?.tuning ?? [];
  const naming: Naming = { mode: options.labelMode ?? DEFAULT_LABEL_MODE, tuning, capo: timeline.tracks[trackIndex]?.capo ?? 0, spelling: spellingForTuning(tuning) };
  const profile = options.profile ?? NECK_PROFILE;
  const place = options.zoom ? zoomedPlacement(width, height, notes, t, stringCount, profile) : photoPlacement(width, height, undefined, profile);
  const pickX = options.techniqueCues ? profile.pickX : undefined;
  const pick = pickX !== undefined ? pickPlan(notes, timeline.bars) : null;
  const cues = options.techniqueCues ? cuesAt(notes, t, moment.lookahead, stringCount, pick ?? undefined, moment) : null;
  const poseOf = (note: NoteEvent) => cues?.poses.get(note.id);
  /** A note a hammer-on or pull-off ends on: a softer ring, with no pop. */
  const unpicked = (note: NoteEvent) => cues?.unpicked.has(note.id) ?? false;
  const ringWidth = (note: NoteEvent) => (cues?.effects.get(note.id)?.muted ? 0.6 : 1);

  ctx.save();
  drawDigitalNeck(ctx, place, stringCount);

  drawLitStrings(ctx, place, stringCount, moment.soundingNotes, moment.upcoming, theme, t, cues, pickX ?? profile.endX);
  moment.trail.forEach((step, i) => {
    for (const note of step.notes) {
      drawRing(ctx, place, stringCount, note, 0.85, (0.3 - i * 0.08) * (unpicked(note) ? UNPICKED_STRENGTH : 1), theme, naming, false, ringWidth(note), poseOf(note));
    }
  });
  moment.upcoming.forEach((step, i) => {
    for (const note of step.notes) {
      const soft = unpicked(note);
      const grow = soft ? 1 : emphasisAt(note.startSeconds, note.endSeconds, t).scale;
      drawRing(ctx, place, stringCount, note, 0.8 * grow, (0.9 - i * 0.1) * (soft ? UNPICKED_STRENGTH : 1), theme, naming, false, ringWidth(note), poseOf(note));
    }
  });
  for (const note of moment.soundingNotes) {
    const e = emphasisAt(note.startSeconds, note.endSeconds, t);
    if (unpicked(note)) {
      drawRing(ctx, place, stringCount, note, 1.1, UNPICKED_STRENGTH, theme, naming, false, ringWidth(note), poseOf(note));
      continue;
    }
    drawHalo(ctx, place, stringCount, note, e.scale, e.pop, theme, poseOf(note));
    drawRing(ctx, place, stringCount, note, e.scale, 1, theme, naming, true, ringWidth(note), poseOf(note));
  }
  if (cues) drawNeckCues(ctx, neckSpace(place, stringCount, width, height, cues.poses), cues, theme);
  if (pick) drawPick(ctx, place, stringCount, pickAt(pick, t), theme);
  drawOpenAndMuted(ctx, width, stringCount, moment.soundingNotes, moment.upcoming[0], theme);
  ctx.restore();
}

/**
 * Open strings (an O) and muted strings (an X) are shown as symbols in a row along the top of the screen, one slot per string,
 * rather than by moving the camera to the nut or off to a muted fret. A note sounding now is bright; the next step's are faint.
 */
function drawOpenAndMuted(ctx: DrawContext, width: number, stringCount: number, sounding: readonly NoteEvent[], next: Step | undefined, theme: HighwayTheme): void {
  const slot = Math.min(width / (stringCount + 1), 72);
  const size = Math.max(12, Math.round(slot * 0.5));
  const left = width / 2 - (slot * (stringCount - 1)) / 2;
  const top = size * 1.2;
  const mark = (note: NoteEvent, strength: number) => {
    const symbol = note.techniques.dead ? 'X' : note.fret <= 0 ? 'O' : null;
    if (!symbol || strength <= 0) return;
    ctx.globalAlpha = Math.min(1, strength);
    ctx.fillStyle = stringColor(theme, note.string);
    ctx.fillText(symbol, left + slot * (note.string - 1), top);
  };
  ctx.save();
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const note of next?.notes ?? []) mark(note, 0.4);
  for (const note of sounding) mark(note, 1);
  ctx.restore();
}

/** Photo-Y of the board's top and bottom edges at photo-X `x`, a little outside the outer strings. */
const boardTop = (x: number, profile: NeckProfile) => photoStringY(1, 2, x, profile) - 6;
const boardBottom = (x: number, profile: NeckProfile) => photoStringY(2, 2, x, profile) + 7;
const FAR = 5000;
/** How much everything but the fretboard is dimmed: one level over the table, the headstock and the body, so no edge shows where the board ends. */
const OUTSIDE_DIM = 0.62;
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
  const { profile } = place;
  const { nutX, fretX, stringKnotsX } = profile;
  const BOARD_LEFT = nutX - 2;
  const BOARD_RIGHT = fretX[fretX.length - 1] + 6;
  const edge = [BOARD_LEFT, ...stringKnotsX.filter((k) => k > BOARD_LEFT && k < BOARD_RIGHT), BOARD_RIGHT];
  const topEdge = edge.map((x) => [x, boardTop(x, profile)] as const);
  const bottomEdge = edge.map((x) => [x, boardBottom(x, profile)] as const);

  // dim the table, the headstock and the body
  ctx.fillStyle = '#020b0f';
  ctx.globalAlpha = OUTSIDE_DIM;
  fillPhotoPolygon(ctx, place, [[-FAR, -FAR], [BOARD_LEFT, -FAR], [BOARD_LEFT, FAR], [-FAR, FAR]]);
  ctx.globalAlpha = OUTSIDE_DIM;
  fillPhotoPolygon(ctx, place, [[BOARD_RIGHT, -FAR], [FAR, -FAR], [FAR, FAR], [BOARD_RIGHT, FAR]]);
  ctx.globalAlpha = OUTSIDE_DIM;
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
  [nutX, ...fretX].forEach((x, i) => {
    ctx.globalAlpha = i === 0 ? 0.7 : 0.38;
    ctx.lineWidth = i === 0 ? px * 2.4 : px * 1.1;
    line(x, boardTop(x, profile), x, boardBottom(x, profile));
  });

  // thin string lines from the nut to the last fret
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = px * 0.8;
  for (let s = 1; s <= stringCount; s++) {
    line(nutX, photoStringY(s, stringCount, nutX, profile), BOARD_RIGHT, photoStringY(s, stringCount, BOARD_RIGHT, profile));
  }

  // fret numbers just under the board, at the frets that carry inlays
  ctx.fillStyle = GLASS;
  ctx.globalAlpha = 0.75;
  ctx.font = `${Math.max(10, Math.round(place.scale * 6))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const fret of profile.inlayFrets) {
    const x = photoNoteX(fret, profile);
    const at = photoToScreen(place, x, boardBottom(x, profile) + 11);
    ctx.fillText(String(fret), at.x, at.y);
  }
  ctx.globalAlpha = 1;
}

/** The screen positions the technique cues are drawn against. */
function neckSpace(place: PhotoPlacement, stringCount: number, width: number, height: number, poses?: ReadonlyMap<string, FingerPose>): NeckSpace {
  return {
    ring: (note) => markerCentre(place, stringCount, note, poses?.get(note.id)),
    rest: (note) => markerCentre(place, stringCount, note),
    at: (string, fret) => {
      const px = photoNoteXAt(fret, place.profile);
      return photoToScreen(place, px, photoStringY(string, stringCount, px, place.profile));
    },
    scale: place.scale,
    width,
    height,
    stringCount,
  };
}

/** Where a note's ring is on the screen: at its fret and string, or where its finger is while it moves. */
function markerCentre(place: PhotoPlacement, stringCount: number, note: NoteEvent, pose?: FingerPose): { x: number; y: number; r: number } {
  const { profile } = place;
  const px = pose ? photoNoteXAt(pose.fret, profile) : photoNoteX(note.fret, profile);
  const py = photoStringY(note.string, stringCount, px, profile) + (pose ? acrossOffset(note.string, stringCount, px, pose.across, profile) : 0);
  return { ...photoToScreen(place, px, py), r: photoRingRadius(note.fret, profile) * place.scale * (pose?.press ?? 1) };
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
  sounding: readonly NoteEvent[],
  upcoming: readonly Step[],
  theme: HighwayTheme,
  t: number,
  cues: NeckCues | null,
  /** Photo-X where the lit strings end: the pick point when the pick effects are on, else where the strings end. */
  end: number,
): void {
  const light = (note: NoteEvent, base: number) => {
    const effect = cues?.effects.get(note.id);
    const pose = cues?.poses.get(note.id);
    const strength = base * (effect?.muted ? MUTED_STRENGTH : 1) * (cues?.unpicked.has(note.id) ? UNPICKED_STRENGTH : 1);
    const { profile } = place;
    const from = pose ? photoNoteXAt(pose.fret, profile) : photoNoteX(note.fret, profile);
    const stops = effect && (effect.bend > 0 || effect.shiver > 0 || effect.pluck) ? sampledStops(from, end) : [from, ...profile.stringKnotsX.filter((k) => k > from && k < end), end];
    ctx.strokeStyle = stringColor(theme, note.string);
    for (const [grow, alpha] of [[9, 0.12], [5, 0.22], [2, 0.95]] as const) {
      ctx.globalAlpha = alpha * strength;
      ctx.lineWidth = grow * Math.max(1, place.scale / 2);
      ctx.beginPath();
      stops.forEach((px, i) => {
        const y = photoStringY(note.string, stringCount, px, profile) + stringOffset(effect, note.string, stringCount, px, from, end, t, profile);
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
  for (const note of sounding) light(note, 1);
}

/** A lit string drawn at half strength for a palm-muted note. */
const MUTED_STRENGTH = 0.5;
/** Points along a string that bends or shivers, enough to look like a curve. */
const SAMPLES = 24;

function sampledStops(from: number, end: number): number[] {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => from + ((end - from) * i) / SAMPLES);
}

/** How far a full pluck pulls the string across, in shares of the gap to its neighbour. */
const PLUCK_REACH = 0.35;

/**
 * How far, in photo pixels, a bent or shivering note's lit string is off the straight line at photo-X `x`. The string leaves the
 * displaced ring and runs straight to the bridge, which does not move, so the offset tapers to nothing there; a vibrato wave
 * travels along it from the ring.
 */
function stringOffset(effect: NoteEffect | undefined, string: number, stringCount: number, x: number, from: number, end: number, t: number, profile: NeckProfile): number {
  if (!effect || (effect.bend === 0 && effect.shiver === 0 && !effect.pluck)) return 0;
  const taper = 1 - Math.min(1, Math.max(0, (x - from) / Math.max(1, end - from)));
  const wave = effect.shiver * SHIVER_REACH * Math.sin(2 * Math.PI * SHIVER_HERTZ * t - (x - from) * 0.06);
  // a plucked string is held at the finger and swings most where the pick pulled it
  const reach = Math.min(1, Math.max(0, (x - from) / Math.max(1, end - from)));
  const pluck = (effect.pluck ?? 0) * PLUCK_REACH * Math.sin((Math.PI / 2) * reach);
  const share = (effect.bend * BEND_REACH * bendSide(string, stringCount) + wave) * taper + pluck;
  return acrossOffset(string, stringCount, x, share, profile);
}

/**
 * The pick's length from tip to base, in photo pixels. The strings sit about 14 apart at the pick point, so this is kept near one
 * and a half gaps: big enough to read at a glance, small enough that a step to the next string still visibly moves it.
 */
export const PICK_SIZE = 22;

/**
 * The picking hand on the body: a flash on each string the pick has just reached, and the pick itself, a rounded triangle on the
 * string it last played whose tip points the way the stroke goes. Drawn only for a photo that has a pick point.
 */
function drawPick(ctx: DrawContext, place: PhotoPlacement, stringCount: number, pick: PickState, theme: HighwayTheme): void {
  const { profile } = place;
  const px = profile.pickX;
  if (px === undefined) return;
  const onString = (string: number) => photoToScreen(place, px, photoStringY(string, stringCount, px, profile));

  for (const flash of pick.flashes) {
    const c = onString(flash.string);
    ctx.fillStyle = stringColor(theme, flash.string);
    for (const [reach, alpha] of [[16, 0.14], [9, 0.3]] as const) {
      ctx.globalAlpha = alpha * flash.strength;
      ctx.beginPath();
      ctx.arc(c.x, c.y, reach * place.scale * (0.6 + 0.4 * flash.strength), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.95 * flash.strength;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4 * place.scale, 0, Math.PI * 2);
    ctx.fill();
  }

  const c = onString(pick.string);
  // the way the stroke goes, from the string behind the pick to the one ahead, both kept on the neck so the edge strings have a direction too
  const sign = pick.stroke === 'down' ? 1 : -1;
  const onNeck = (string: number) => onString(Math.min(stringCount, Math.max(1, string)));
  const ahead = onNeck(pick.string + sign);
  const behind = onNeck(pick.string - sign);
  const length = Math.hypot(ahead.x - behind.x, ahead.y - behind.y) || 1;
  const dx = (ahead.x - behind.x) / length;
  const dy = (ahead.y - behind.y) / length;
  const size = PICK_SIZE * place.scale;
  const tip = { x: c.x + dx * size * 0.55, y: c.y + dy * size * 0.55 };
  const base = { x: c.x - dx * size * 0.45, y: c.y - dy * size * 0.45 };
  const left = { x: base.x - dy * size * 0.5, y: base.y + dx * size * 0.5 };
  const right = { x: base.x + dy * size * 0.5, y: base.y - dx * size * 0.5 };
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const trace = () => {
    const start = mid(tip, right);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const [corner, next] of [[tip, left], [left, right], [right, tip]] as const) {
      const to = mid(corner, next);
      ctx.quadraticCurveTo(corner.x, corner.y, to.x, to.y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.92;
  trace();
  ctx.fill();
  ctx.strokeStyle = stringColor(theme, Math.round(pick.string));
  ctx.lineWidth = Math.max(1.5, place.scale * 1.2);
  ctx.globalAlpha = 0.9;
  trace();
  ctx.stroke();
  ctx.globalAlpha = 1;
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
