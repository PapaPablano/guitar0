import type { DrawContext } from './draw-context';
import { computeLayout, isActive, laneY, noteX, timeToX, type HighwayLayout } from './layout';
import { drawTechniques, fretLabel } from './techniques';
import { DEFAULT_THEME, stringColor, type HighwayTheme } from './theme';
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

  drawBarLines(ctx, timeline, layout, theme, t);
  drawStrings(ctx, layout, theme);

  const from = t - layout.lookbehindSeconds;
  const to = t + layout.lookaheadSeconds;
  const visible = visibleNotes(notes, from, to);
  for (const note of visible) drawSustain(ctx, note, layout, theme, t);
  for (const note of visible) drawNote(ctx, note, layout, theme, t);
  drawTechniques(ctx, visible, layout, theme, t);

  ctx.strokeStyle = theme.strikeline;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(layout.strikeX, layout.laneTop);
  ctx.lineTo(layout.strikeX, layout.laneTop + layout.laneHeight * layout.stringCount);
  ctx.stroke();

  for (const note of visible) drawHitEffect(ctx, note, layout, theme, t);
  ctx.restore();
}

function drawStrings(ctx: DrawContext, layout: HighwayLayout, theme: HighwayTheme): void {
  ctx.strokeStyle = theme.laneLine;
  ctx.globalAlpha = 1;
  for (let s = 1; s <= layout.stringCount; s++) {
    const y = laneY(layout, s);
    ctx.lineWidth = 1 + (s - 1) * 0.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(layout.width, y);
    ctx.stroke();
  }
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
  ctx.strokeStyle = theme.barLine;
  ctx.fillStyle = theme.barLabel;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const bar of timeline.bars) {
    const x = timeToX(layout, bar.startSeconds, t);
    if (x < 0 || x > layout.width) continue;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.fillText(String(bar.scoreBar + 1), x + 4, top - 16);
  }
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
  const x = noteX(layout, note, t);
  const y = laneY(layout, note.string);
  const passed = note.startSeconds < t && !active;
  ctx.globalAlpha = passed ? Math.max(0, 0.35 - ((t - note.endSeconds) / layout.lookbehindSeconds) * 0.35) : 1;
  if (ctx.globalAlpha <= 0) return;
  ctx.fillStyle = stringColor(theme, note.string);
  ctx.beginPath();
  ctx.arc(x, y, layout.noteRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.noteText;
  ctx.font = `bold ${Math.round(layout.noteRadius * 1.2)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fretLabel(note), x, y);
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
