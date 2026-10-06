import type { DrawContext } from './draw-context';
import { DEFAULT_LOOKAHEAD, maxFretUsed, stepsAt, type Step } from './fretboard-steps';
import { emphasisAt } from './emphasis';
import { DEFAULT_THEME, stringColor, type HighwayTheme } from './theme';
import { noteName, spellingForTuning, type NoteSpelling } from './note-names';
import { fretLabel } from './techniques';
import type { NoteEvent, Timeline } from '../model/score';

/** What a dot says: the fret number, the note name, or the name with the fret under it. */
export type LabelMode = 'fret' | 'note' | 'both';

export const DEFAULT_LABEL_MODE: LabelMode = 'fret';

export const MIN_FRETS = 7;
export const MAX_FRETS = 24;
export const MIN_DOT_RADIUS = 7;
const MAX_DOT_RADIUS = 28;

const POSITION_MARKS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_MARKS = [12, 24];

export interface NeckLayout {
  readonly width: number;
  readonly height: number;
  readonly stringCount: number;
  readonly fretCount: number;
  readonly nutX: number;
  readonly boardRight: number;
  readonly top: number;
  readonly bottom: number;
  readonly stringGap: number;
  readonly dotRadius: number;
}

/** The neck for a track: from the nut to the highest fret it uses, never fewer than 7 or more than 24. */
export function computeNeck(width: number, height: number, stringCount: number, highestFret: number): NeckLayout {
  const strings = Math.max(1, stringCount);
  const fretCount = Math.min(MAX_FRETS, Math.max(MIN_FRETS, highestFret));
  const nutX = Math.max(110, width * 0.09);
  const boardRight = width - Math.max(16, width * 0.015);
  const top = height * 0.2;
  const bottom = height * 0.8;
  const stringGap = strings > 1 ? (bottom - top) / (strings - 1) : 0;
  const neck = { width, height, stringCount: strings, fretCount, nutX, boardRight, top, bottom, stringGap, dotRadius: 0 };
  const lastFretWidth = fretLineX({ ...neck, dotRadius: 0 }, fretCount) - fretLineX({ ...neck, dotRadius: 0 }, fretCount - 1);
  const room = strings > 1 ? stringGap * 0.42 : MAX_DOT_RADIUS;
  const dotRadius = Math.min(MAX_DOT_RADIUS, Math.max(MIN_DOT_RADIUS, Math.min(room, lastFretWidth * 0.45)));
  return { ...neck, dotRadius };
}

/** X of a fret line; fret 0 is the nut. Spacing follows the real shrinking of frets up the neck. */
export function fretLineX(neck: NeckLayout, fret: number): number {
  const full = 1 - Math.pow(2, -neck.fretCount / 12);
  const here = 1 - Math.pow(2, -fret / 12);
  return neck.nutX + ((neck.boardRight - neck.nutX) * here) / full;
}

/**
 * X of a note's dot: between its fret lines, or just left of the nut for an open string. A fret
 * beyond the last one drawn (the neck stops at 24) sits on the last fret; its label keeps the real number.
 */
export function noteDotX(neck: NeckLayout, fret: number): number {
  if (fret <= 0) return neck.nutX - neck.dotRadius - 8;
  const shown = Math.min(fret, neck.fretCount);
  return (fretLineX(neck, shown - 1) + fretLineX(neck, shown)) / 2;
}

/** Y of a string; string 1 (highest pitched) is on top, as on the tab strip. */
export function stringLineY(neck: NeckLayout, string: number): number {
  return neck.stringCount > 1 ? neck.top + (string - 1) * neck.stringGap : (neck.top + neck.bottom) / 2;
}

export interface FretboardOptions {
  readonly theme?: HighwayTheme;
  readonly lookahead?: number;
  readonly labelMode?: LabelMode;
}

/** What the labels need to name a note: the track's open-string pitches and how to spell them. */
interface Naming {
  readonly mode: LabelMode;
  readonly tuning: readonly number[];
  readonly spelling: NoteSpelling;
}

/** The text on a dot, and the small fret number under it in 'both' mode. */
export function dotText(note: NoteEvent, naming: Naming): { main: string; badge: string | null } {
  const open = naming.tuning[note.string - 1];
  if (naming.mode === 'fret' || open === undefined) return { main: fretLabel(note), badge: null };
  if (note.techniques.dead) return { main: 'x', badge: null };
  const name = noteName(open + note.fret, naming.spelling);
  const main = note.techniques.ghost ? `(${name})` : name;
  return { main, badge: naming.mode === 'both' ? String(note.fret) : null };
}

/** The note the path passes through for a step: its lowest-pitched note. */
function anchor(step: Step): NoteEvent {
  return step.notes.reduce((low, n) => (n.string > low.string ? n : low));
}

/**
 * Draws the fretboard view for one track at time `t`: the neck, a fading trail, a dashed path to
 * the next steps with outlined markers, and the playing notes as solid dots on top. A pure
 * function of its arguments, like the highway.
 */
export function renderFretboard(
  ctx: DrawContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: FretboardOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_THEME;
  const notes = timeline.notesForTrack(trackIndex);
  const stringCount = timeline.tracks[trackIndex]?.stringCount ?? 6;
  const neck = computeNeck(width, height, stringCount, maxFretUsed(notes));
  const steps = stepsAt(notes, t, options.lookahead ?? DEFAULT_LOOKAHEAD);
  const tuning = timeline.tracks[trackIndex]?.tuning ?? [];
  const naming: Naming = {
    mode: options.labelMode ?? DEFAULT_LABEL_MODE,
    tuning,
    spelling: spellingForTuning(tuning),
  };

  ctx.save();
  ctx.globalAlpha = 1;
  drawBackdrop(ctx, width, height);
  drawNeck(ctx, neck, theme, naming);
  drawLitStrings(ctx, neck, steps.playing, steps.upcoming, theme, t);

  steps.trail.forEach((step, i) => {
    for (const note of step.notes) drawDot(ctx, neck, note, neck.dotRadius * 0.8, theme, 0.35 - i * 0.1, 'solid', naming);
  });

  drawPath(ctx, neck, steps.playing, steps.upcoming, theme);

  const playing = steps.playing;
  steps.upcoming.forEach((step, i) => {
    for (const note of step.notes) {
      const onPlaying = playing?.notes.some((p) => p.string === note.string && p.fret === note.fret) ?? false;
      if (onPlaying) drawRing(ctx, neck, note, theme, 0.9 - i * 0.1);
      else {
        // The next marker swells as its moment nears.
        const grow = emphasisAt(note.startSeconds, note.endSeconds, t).scale;
        drawDot(ctx, neck, note, neck.dotRadius * 0.7 * grow, theme, 0.95 - i * 0.1, 'outline', naming);
      }
    }
  });

  if (playing) {
    for (const note of playing.notes) {
      // The note to play is drawn larger, popping on its beat, with a halo that flares then settles.
      const e = emphasisAt(note.startSeconds, note.endSeconds, t);
      const radius = neck.dotRadius * e.scale;
      if (e.sounding) drawHalo(ctx, neck, note, radius, e.pop, theme);
      drawDot(ctx, neck, note, radius, theme, 1, 'solid', naming);
    }
  }
  ctx.restore();
}

/** A dark teal studio backdrop with a soft pool of light behind the neck, built from stacked bands. */
function drawBackdrop(ctx: DrawContext, width: number, height: number): void {
  ctx.fillStyle = '#04161c';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1d5560';
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const inset = (height / 2) * (i / bands);
    ctx.globalAlpha = 0.07;
    ctx.fillRect(0, inset, width, height - inset * 2);
  }
  ctx.globalAlpha = 1;
}

function drawNeck(ctx: DrawContext, neck: NeckLayout, theme: HighwayTheme, naming: Naming): void {
  const boardTop = neck.top - neck.stringGap * 0.5 - 6;
  const boardBottom = neck.bottom + neck.stringGap * 0.5 + 6;
  const boardHeight = boardBottom - boardTop;
  const boardWidth = neck.boardRight - neck.nutX;

  // rosewood: a dark base, lit across the middle, with fine grain along the length
  ctx.fillStyle = '#3b2e30';
  ctx.fillRect(neck.nutX, boardTop, boardWidth, boardHeight);
  ctx.fillStyle = '#6b5558';
  const shades = 6;
  for (let i = 0; i < shades; i++) {
    const inset = (boardHeight / 2) * (i / shades);
    ctx.globalAlpha = 0.09;
    ctx.fillRect(neck.nutX, boardTop + inset, boardWidth, boardHeight - inset * 2);
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    const y = boardTop + ((i * 0.6180339887) % 1) * boardHeight;
    const from = neck.nutX + ((i * 0.7548776662) % 1) * boardWidth * 0.5;
    ctx.strokeStyle = i % 3 === 0 ? '#8a7377' : '#1f1517';
    ctx.globalAlpha = i % 3 === 0 ? 0.16 : 0.28;
    ctx.beginPath();
    ctx.moveTo(from, y);
    ctx.lineTo(Math.min(neck.boardRight, from + boardWidth * (0.3 + ((i * 0.5698402909) % 1) * 0.5)), y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // pale binding along both edges of the board
  ctx.fillStyle = '#dfe5e8';
  ctx.fillRect(neck.nutX, boardTop - 3, boardWidth, 3);
  ctx.fillRect(neck.nutX, boardBottom, boardWidth, 3);

  // position markers
  ctx.fillStyle = '#c9c4d4';
  ctx.globalAlpha = 0.35;
  const midY = (neck.top + neck.bottom) / 2;
  for (const fret of POSITION_MARKS) {
    if (fret > neck.fretCount) continue;
    dot(ctx, noteDotX(neck, fret), midY, neck.dotRadius * 0.45);
  }
  for (const fret of DOUBLE_MARKS) {
    if (fret > neck.fretCount) continue;
    const x = noteDotX(neck, fret);
    dot(ctx, x, midY - neck.stringGap * 0.9, neck.dotRadius * 0.45);
    dot(ctx, x, midY + neck.stringGap * 0.9, neck.dotRadius * 0.45);
  }
  ctx.globalAlpha = 1;

  // frets and nut: a thin bright wire with a shadow just past it
  for (let f = 0; f <= neck.fretCount; f++) {
    const x = fretLineX(neck, f);
    if (f > 0) {
      ctx.strokeStyle = '#000000';
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 2, boardTop);
      ctx.lineTo(x + 2, boardBottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = f === 0 ? '#eef0f0' : '#b9bfc6';
    ctx.lineWidth = f === 0 ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(x, boardTop);
    ctx.lineTo(x, boardBottom);
    ctx.stroke();
  }

  // strings, thicker toward the bass, each over a faint shadow
  for (let s = 1; s <= neck.stringCount; s++) {
    const y = stringLineY(neck, s);
    const width = 1 + (s - 1) * 0.5;
    ctx.strokeStyle = '#000000';
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = width + 1;
    ctx.beginPath();
    ctx.moveTo(neck.nutX, y + 2);
    ctx.lineTo(neck.boardRight, y + 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#cfd3d8';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(neck.nutX - neck.dotRadius * 2 - 16, y);
    ctx.lineTo(neck.boardRight, y);
    ctx.stroke();
  }

  // open-string names at the far left, from the track's own tuning
  ctx.fillStyle = '#e8eaf0';
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let s = 1; s <= neck.stringCount; s++) {
    const open = naming.tuning[s - 1];
    if (open !== undefined) ctx.fillText(noteName(open, naming.spelling), 24, stringLineY(neck, s));
  }

  // fret numbers under the neck
  ctx.fillStyle = theme.barLabel;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let f = 1; f <= neck.fretCount; f++) ctx.fillText(String(f), noteDotX(neck, f), boardBottom + 8);
}

/**
 * Lights the string under each marker in the note's colour, from the marker toward the bridge: a
 * wide soft glow under a bright core for the note being played, a faint line for the ones coming.
 */
function drawLitStrings(
  ctx: DrawContext,
  neck: NeckLayout,
  playing: Step | null,
  upcoming: readonly Step[],
  theme: HighwayTheme,
  t: number,
): void {
  const light = (note: NoteEvent, strength: number) => {
    const x = noteDotX(neck, note.fret);
    const y = stringLineY(neck, note.string);
    ctx.strokeStyle = stringColor(theme, note.string);
    for (const [grow, alpha] of [[7, 0.1], [4, 0.2], [1.5, 0.9]] as const) {
      ctx.globalAlpha = alpha * strength;
      ctx.lineWidth = grow;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(neck.boardRight, y);
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

function dot(ctx: DrawContext, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawDot(
  ctx: DrawContext,
  neck: NeckLayout,
  note: NoteEvent,
  radius: number,
  theme: HighwayTheme,
  alpha: number,
  kind: 'solid' | 'outline',
  naming: Naming,
): void {
  const x = noteDotX(neck, note.fret);
  const y = stringLineY(neck, note.string);
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  // A thin glowing ring around a dark centre; an upcoming marker is the same ring, dimmer.
  ctx.fillStyle = '#04161c';
  ctx.globalAlpha = Math.max(0, alpha) * (kind === 'solid' ? 0.7 : 0.55);
  ctx.fill();
  ctx.globalAlpha = Math.max(0, alpha) * (kind === 'solid' ? 1 : 0.8);
  ctx.strokeStyle = stringColor(theme, note.string);
  ctx.lineWidth = Math.max(2, radius * 0.14);
  ctx.stroke();
  ctx.globalAlpha = Math.max(0, alpha);
  // label: dark text on a solid dot, light on an outlined one
  if (alpha > 0.05) {
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(radius * 1.1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = dotText(note, naming);
    ctx.fillText(text.main, x, y);
    if (text.badge) {
      ctx.fillStyle = '#e8eaf0';
      ctx.font = `${Math.max(9, Math.round(radius * 0.8))}px system-ui, sans-serif`;
      ctx.fillText(text.badge, x, y + radius + 8);
    }
  }
  ctx.globalAlpha = 1;
}

/** A soft glow around the note being played; wider and brighter right at its start. */
function drawHalo(
  ctx: DrawContext,
  neck: NeckLayout,
  note: NoteEvent,
  radius: number,
  pop: number,
  theme: HighwayTheme,
): void {
  const x = noteDotX(neck, note.fret);
  const y = stringLineY(neck, note.string);
  ctx.strokeStyle = stringColor(theme, note.string);
  for (const [extra, alpha, width] of [[8 + 10 * pop, 0.14, 6], [4 + 5 * pop, 0.28, 3]] as const) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, radius + extra, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawRing(ctx: DrawContext, neck: NeckLayout, note: NoteEvent, theme: HighwayTheme, alpha: number): void {
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.strokeStyle = stringColor(theme, note.string);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(noteDotX(neck, note.fret), stringLineY(neck, note.string), neck.dotRadius * 1.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** A dashed path from the playing step through each upcoming step; repeated positions add no segment. */
function drawPath(
  ctx: DrawContext,
  neck: NeckLayout,
  playing: Step | null,
  upcoming: readonly Step[],
  theme: HighwayTheme,
): void {
  const chain = [...(playing ? [playing] : []), ...upcoming].map((step) => {
    const note = anchor(step);
    return { x: noteDotX(neck, note.fret), y: stringLineY(neck, note.string) };
  });
  ctx.strokeStyle = theme.strikeline;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([5, 6]);
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1];
    const to = chain[i];
    if (from.x === to.x && from.y === to.y) continue;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}
