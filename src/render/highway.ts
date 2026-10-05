import type { DrawContext } from './draw-context';
import { computeLayout, isActive, laneY, noteX, timeToX, type HighwayLayout } from './layout';
import { noteName, spellingForTuning } from './note-names';
import { drawTechniques, fretLabel } from './techniques';
import { DEFAULT_THEME, stringColor, stringShade, type HighwayTheme } from './theme';
import type { NoteEvent, Timeline } from '../model/score';

/** How long the ring at the strikeline expands after a note is struck. */
export const HIT_EFFECT_SECONDS = 0.25;

export interface HighwayOptions {
  readonly theme?: HighwayTheme;
  readonly lookaheadSeconds?: number;
}

const maxDurationCache = new WeakMap<readonly NoteEvent[], number>();

function maxDuration(notes: readonly NoteEvent[]): number {
  let cached = maxDurationCache.get(notes);
  if (cached === undefined) {
    cached = 0;
    for (const n of notes) cached = Math.max(cached, n.endSeconds - n.startSeconds);
    maxDurationCache.set(notes, cached);
  }
  return cached;
}

/** First index whose start is at or after `time`; notes are sorted by start. */
function lowerBound(notes: readonly NoteEvent[], time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startSeconds < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Notes whose body overlaps the visible time window. */
export function visibleNotes(
  notes: readonly NoteEvent[],
  from: number,
  to: number,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = lowerBound(notes, from - maxDuration(notes)); i < notes.length; i++) {
    const n = notes[i];
    if (n.startSeconds > to) break;
    if (n.endSeconds >= from) out.push(n);
  }
  return out;
}

/** Box of a note gem; `x` and `y` are its top-left corner. */
export interface GemBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const GEM_HALF_WIDTH = 1.4;
const GEM_HALF_HEIGHT = 0.95;

export function gemBox(layout: HighwayLayout, note: NoteEvent, t: number): GemBox {
  return gemBoxAt(layout, noteX(layout, note, t), laneY(layout, note.string));
}

function gemBoxAt(layout: HighwayLayout, cx: number, cy: number): GemBox {
  const w = layout.noteRadius * GEM_HALF_WIDTH * 2;
  const h = layout.noteRadius * GEM_HALF_HEIGHT * 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Draws the highway for one track at time `t`. A pure function of its arguments: the same
 * timeline, track, time and size always produce the same drawing calls.
 */
export function renderHighway(
  ctx: DrawContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: HighwayOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_THEME;
  const track = timeline.tracks[trackIndex];
  const stringCount = track?.stringCount ?? 6;
  const layout = computeLayout(width, height, stringCount, options.lookaheadSeconds);
  const notes = timeline.notesForTrack(trackIndex);

  ctx.save();
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  drawLaneTints(ctx, layout, theme);
  drawBarLines(ctx, timeline, layout, theme, t);
  drawStrings(ctx, layout, theme);

  // Drawn before the notes, so a note crossing the line is never covered by it.
  drawStrikeLine(ctx, layout, theme);

  const from = t - layout.lookbehindSeconds;
  const to = t + layout.lookaheadSeconds;
  const visible = visibleNotes(notes, from, to);
  drawStrikeRings(ctx, visible, layout, theme, t);
  for (const note of visible) drawSustain(ctx, note, layout, theme, t);
  for (const note of visible) drawNote(ctx, note, layout, theme, t);
  drawTechniques(ctx, visible, layout, theme, t);

  for (const note of visible) drawHitEffect(ctx, note, layout, theme, t);
  // The nut hides notes that have passed, so it goes over them.
  drawNut(ctx, layout, theme, track?.tuning ?? []);
  drawEdgeFade(ctx, layout, theme);
  ctx.restore();
}

/** A closed rounded rectangle, built from lines and curves so it never reads as a note-head arc. */
function roundedRectPath(ctx: DrawContext, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Fills a rectangle as a path, so it is not counted as a sustain-tail `fillRect`. */
function fillBox(ctx: DrawContext, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
}

/** A faint wash of each string's colour across its lane. */
function drawLaneTints(ctx: DrawContext, layout: HighwayLayout, theme: HighwayTheme): void {
  ctx.globalAlpha = 0.07;
  for (let s = 1; s <= layout.stringCount; s++) {
    ctx.fillStyle = stringColor(theme, s);
    ctx.fillRect(0, layout.laneTop + (s - 1) * layout.laneHeight, layout.width, layout.laneHeight);
  }
  ctx.globalAlpha = 1;
}

function drawStrings(ctx: DrawContext, layout: HighwayLayout, theme: HighwayTheme): void {
  for (let s = 1; s <= layout.stringCount; s++) {
    const y = laneY(layout, s);
    ctx.strokeStyle = stringColor(theme, s);
    ctx.lineWidth = 1 + (s - 1) * 0.4;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(layout.width, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawBarLines(
  ctx: DrawContext,
  timeline: Timeline,
  layout: HighwayLayout,
  theme: HighwayTheme,
  t: number,
): void {
  const top = layout.laneTop;
  const bottom = layout.laneTop + layout.laneHeight * layout.stringCount;
  const midY = (top + bottom) / 2;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const bar of timeline.bars) {
    const x = timeToX(layout, bar.startSeconds, t);
    const barWidth = (bar.endSeconds - bar.startSeconds) * layout.pxPerSecond;
    if (x + barWidth < 0 || x > layout.width) continue;

    // Beat lines first, so the inlay and the bar line sit over them.
    const beats = Math.max(1, bar.timeSignature.numerator);
    ctx.strokeStyle = theme.beatLine;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.08;
    for (let b = 1; b < beats; b++) {
      const bx = x + (barWidth * b) / beats;
      ctx.beginPath();
      ctx.moveTo(bx, top);
      ctx.lineTo(bx, bottom);
      ctx.stroke();
    }

    // Decorative inlay: a dot mid-bar, a pair every fourth bar.
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.inlay;
    const dotX = x + barWidth / 2;
    const dotR = layout.noteRadius * 0.4;
    const offsets = bar.scoreBar % 4 === 3 ? [-layout.laneHeight, layout.laneHeight] : [0];
    for (const dy of offsets) {
      ctx.beginPath();
      ctx.arc(dotX, midY + dy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (x < 0 || x > layout.width) continue;
    ctx.strokeStyle = theme.measureLine;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.barLabel;
    ctx.fillText(String(bar.scoreBar + 1), x + 4, top - 16);
  }
  ctx.globalAlpha = 1;
}

function drawStrikeLine(ctx: DrawContext, layout: HighwayLayout, theme: HighwayTheme): void {
  const top = layout.laneTop;
  const bottom = layout.laneTop + layout.laneHeight * layout.stringCount;
  ctx.strokeStyle = theme.strikeline;
  // Glow: wider, fainter strokes under the core line.
  const passes: readonly (readonly [number, number])[] = [[14, 0.1], [8, 0.18], [3, 1]];
  for (const [lineWidth, alpha] of passes) {
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(layout.strikeX, top);
    ctx.lineTo(layout.strikeX, bottom);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** One outlined target per string at the strikeline; it lights while a note on that string sounds. */
function drawStrikeRings(
  ctx: DrawContext,
  visible: readonly NoteEvent[],
  layout: HighwayLayout,
  theme: HighwayTheme,
  t: number,
): void {
  const lit = new Set<number>();
  for (const note of visible) if (isActive(note, t)) lit.add(note.string);
  const glow: readonly (readonly [number, number])[] = [[8, 0.1], [4, 0.18]];
  for (let s = 1; s <= layout.stringCount; s++) {
    const box = gemBoxAt(layout, layout.strikeX, laneY(layout, s));
    const on = lit.has(s);
    const colour = stringColor(theme, s);
    const corner = box.h * 0.3;
    if (on) {
      ctx.fillStyle = colour;
      for (const [grow, alpha] of glow) {
        ctx.globalAlpha = alpha;
        roundedRectPath(ctx, box.x - grow, box.y - grow, box.w + grow * 2, box.h + grow * 2, corner + grow);
        ctx.fill();
      }
      ctx.globalAlpha = 0.3;
      roundedRectPath(ctx, box.x, box.y, box.w, box.h, corner);
      ctx.fill();
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = on ? 3 : 2;
    ctx.globalAlpha = on ? 1 : 0.45;
    roundedRectPath(ctx, box.x, box.y, box.w, box.h, corner);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawSustain(
  ctx: DrawContext,
  note: NoteEvent,
  layout: HighwayLayout,
  theme: HighwayTheme,
  t: number,
): void {
  const seconds = note.endSeconds - note.startSeconds;
  const tailWidth = seconds * layout.pxPerSecond;
  // Only notes that last longer than their head get a visible tail.
  if (tailWidth <= layout.noteRadius * 2) return;
  const headX = noteX(layout, note, t);
  const endX = timeToX(layout, note.endSeconds, t);
  if (endX <= headX) return;
  const y = laneY(layout, note.string);
  const h = layout.noteRadius * 0.7;
  ctx.fillStyle = stringColor(theme, note.string);
  ctx.globalAlpha = note.endSeconds <= t ? 0.2 : 0.55;
  ctx.fillRect(headX, y - h / 2, endX - headX, h);
}

function drawNote(
  ctx: DrawContext,
  note: NoteEvent,
  layout: HighwayLayout,
  theme: HighwayTheme,
  t: number,
): void {
  const active = isActive(note, t);
  const passed = note.startSeconds < t && !active;
  const alpha = passed ? Math.max(0, 0.35 - ((t - note.endSeconds) / layout.lookbehindSeconds) * 0.35) : 1;
  if (alpha <= 0) return;
  const box = gemBox(layout, note, t);
  const corner = box.h * 0.3;
  const lip = Math.max(2, layout.noteRadius * 0.2);
  const colour = stringColor(theme, note.string);

  if (active) {
    ctx.fillStyle = colour;
    const glow: readonly (readonly [number, number])[] = [[8, 0.1], [4, 0.18]];
    for (const [grow, a] of glow) {
      ctx.globalAlpha = alpha * a;
      roundedRectPath(ctx, box.x - grow, box.y - grow, box.w + grow * 2, box.h + grow * 2, corner + grow);
      ctx.fill();
    }
  }
  // The underside first, then the face, so the gem reads as a raised key.
  ctx.globalAlpha = alpha;
  ctx.fillStyle = stringShade(theme, note.string);
  roundedRectPath(ctx, box.x, box.y + lip, box.w, box.h, corner);
  ctx.fill();
  ctx.fillStyle = colour;
  roundedRectPath(ctx, box.x, box.y, box.w, box.h, corner);
  ctx.fill();
  ctx.strokeStyle = theme.gemBorder;
  ctx.lineWidth = 2;
  ctx.globalAlpha = alpha * 0.75;
  ctx.stroke();

  ctx.globalAlpha = alpha;
  ctx.fillStyle = theme.noteText;
  ctx.font = `bold ${Math.round(layout.noteRadius * 1.1)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fretLabel(note), box.x + box.w / 2, box.y + box.h / 2);
}

function drawHitEffect(
  ctx: DrawContext,
  note: NoteEvent,
  layout: HighwayLayout,
  theme: HighwayTheme,
  t: number,
): void {
  const age = t - note.startSeconds;
  if (age < 0 || age >= HIT_EFFECT_SECONDS) return;
  const progress = age / HIT_EFFECT_SECONDS;
  ctx.strokeStyle = stringColor(theme, note.string);
  ctx.globalAlpha = 1 - progress;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(layout.strikeX, laneY(layout, note.string), layout.noteRadius * (1.15 + progress * 1.2), 0, Math.PI * 2);
  ctx.stroke();
}

/** The nut: a panel at the left edge carrying the open-string names. */
function drawNut(
  ctx: DrawContext,
  layout: HighwayLayout,
  theme: HighwayTheme,
  tuning: readonly number[],
): void {
  const panelWidth = Math.max(0, Math.min(56, layout.strikeX - layout.noteRadius * GEM_HALF_WIDTH - 8));
  if (panelWidth < 20) return;
  const top = layout.laneTop;
  const lanes = layout.laneHeight * layout.stringCount;
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.background;
  fillBox(ctx, 0, top, panelWidth, lanes);
  ctx.fillStyle = theme.strikeline;
  fillBox(ctx, panelWidth, top, 4, lanes);
  if (tuning.length === 0) return;
  const spelling = spellingForTuning(tuning);
  ctx.font = `bold ${Math.round(Math.min(20, layout.laneHeight * 0.5))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let s = 1; s <= layout.stringCount; s++) {
    const open = tuning[s - 1];
    if (open === undefined) continue;
    ctx.fillStyle = stringColor(theme, s);
    ctx.fillText(noteName(open, spelling), panelWidth / 2, laneY(layout, s));
  }
}

/** The far right fades into the background, so notes seem to rise out of the dark. */
function drawEdgeFade(ctx: DrawContext, layout: HighwayLayout, theme: HighwayTheme): void {
  // Each strip covers everything to its right too, so the layers stack into a smooth ramp
  // and no two strips overlap at a seam.
  const steps = 16;
  const fadeWidth = layout.width * 0.14;
  const stripWidth = fadeWidth / steps;
  ctx.fillStyle = theme.background;
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < steps; i++) {
    const x = layout.width - fadeWidth + i * stripWidth;
    fillBox(ctx, x, 0, layout.width - x, layout.height);
  }
  ctx.globalAlpha = 1;
}
