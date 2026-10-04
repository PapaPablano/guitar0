import type { DrawContext } from './draw-context';
import { barSpans } from './bars';
import { fretLabel, techniqueMark } from './techniques';
import { playbackBarIndexAt } from '../model/bars';
import { DEFAULT_THEME, type HighwayTheme } from './theme';
import type { BarEvent, NoteEvent, Timeline } from '../model/score';

/** Horizontal pixels per second of music in the strip, with a floor so short bars stay readable. */
const STRIP_PX_PER_SECOND = 70;
const MIN_BAR_WIDTH = 90;
const CURSOR_FRACTION = 0.3;
/** Fret-number colour on the strip's dark background. */
const STRIP_NOTE_TEXT = '#f1f3f5';

export interface StripBar {
  readonly scoreBar: number;
  /** X in strip space (the whole score laid out left to right in score order). */
  readonly x: number;
  readonly width: number;
  /** The first time this bar is played; repeats reuse its notes. */
  readonly playback: BarEvent;
  readonly repeatStart: boolean;
  readonly repeatEnd: boolean;
  readonly notes: readonly NoteEvent[];
}

export interface StripLayout {
  readonly bars: readonly StripBar[];
  readonly totalWidth: number;
  readonly width: number;
  readonly height: number;
  readonly stringCount: number;
  readonly lineTop: number;
  readonly lineGap: number;
  readonly cursorX: number;
}

export interface LoopBars {
  /** Inclusive score-bar range. */
  readonly startBar: number;
  readonly endBar: number;
}

export interface TabStripOptions {
  readonly theme?: HighwayTheme;
  readonly loop?: LoopBars | null;
}

const layoutCache = new WeakMap<Timeline, Map<string, StripLayout>>();

export function getStripLayout(timeline: Timeline, trackIndex: number, width: number, height: number): StripLayout {
  let byKey = layoutCache.get(timeline);
  if (!byKey) {
    byKey = new Map();
    layoutCache.set(timeline, byKey);
  }
  const key = `${trackIndex}:${width}:${height}`;
  let layout = byKey.get(key);
  if (!layout) {
    layout = buildStripLayout(timeline, trackIndex, width, height);
    byKey.set(key, layout);
  }
  return layout;
}

export function buildStripLayout(timeline: Timeline, trackIndex: number, width: number, height: number): StripLayout {
  const stringCount = timeline.tracks[trackIndex]?.stringCount ?? 6;
  const lineTop = height * 0.22;
  const lineGap = (height * 0.42) / Math.max(1, stringCount - 1);

  const notes = timeline.notesForTrack(trackIndex);
  const notesByPlaybackBar = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    const list = notesByPlaybackBar.get(n.playbackBar) ?? [];
    list.push(n);
    notesByPlaybackBar.set(n.playbackBar, list);
  }

  const bars: StripBar[] = [];
  let x = 0;
  for (const { scoreBar, playback, repeatStart, repeatEnd } of barSpans(timeline)) {
    const seconds = playback.endSeconds - playback.startSeconds;
    const barWidth = Math.max(MIN_BAR_WIDTH, seconds * STRIP_PX_PER_SECOND);
    bars.push({
      scoreBar,
      x,
      width: barWidth,
      playback,
      repeatStart,
      repeatEnd,
      notes: notesByPlaybackBar.get(playback.playbackIndex) ?? [],
    });
    x += barWidth;
  }

  return {
    bars,
    totalWidth: x,
    width,
    height,
    stringCount,
    lineTop,
    lineGap,
    cursorX: width * CURSOR_FRACTION,
  };
}

/** X of the playhead in strip space. Across a repeat this jumps back to the repeated bar. */
export function playheadStripX(layout: StripLayout, timeline: Timeline, t: number): number {
  const played = timeline.bars[playbackBarIndexAt(timeline, t)];
  if (!played) return 0;
  const bar = stripBarFor(layout, played.scoreBar);
  if (!bar) return 0;
  const seconds = played.endSeconds - played.startSeconds;
  const fraction = seconds > 0 ? Math.min(1, Math.max(0, (t - played.startSeconds) / seconds)) : 0;
  return bar.x + fraction * bar.width;
}

/** Strip-space x shown at the left edge of the canvas when the playhead is at `t`. */
export function stripScrollX(layout: StripLayout, timeline: Timeline, t: number): number {
  return playheadStripX(layout, timeline, t) - layout.cursorX;
}

/** The strip bar for a score bar index, if the score has it. */
export function stripBarFor(layout: StripLayout, scoreBar: number): StripBar | undefined {
  return layout.bars.find((b) => b.scoreBar === scoreBar);
}

/** Score bar under a canvas x position, or null when the position is outside the score. */
export function scoreBarAtX(layout: StripLayout, timeline: Timeline, t: number, canvasX: number): number | null {
  const stripX = canvasX + stripScrollX(layout, timeline, t);
  for (const bar of layout.bars) {
    if (stripX >= bar.x && stripX < bar.x + bar.width) return bar.scoreBar;
  }
  return null;
}

/** Playback time at the start of a score bar's first pass. */
export function scoreBarStartSeconds(layout: StripLayout, scoreBar: number): number | null {
  return stripBarFor(layout, scoreBar)?.playback.startSeconds ?? null;
}

/** Draws the tab strip: staff lines, bars, fret numbers, rhythm stems and the cursor. */
export function renderTabStrip(
  ctx: DrawContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: TabStripOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_THEME;
  const layout = getStripLayout(timeline, trackIndex, width, height);
  const scroll = stripScrollX(layout, timeline, t);
  const bottom = layout.lineTop + layout.lineGap * (layout.stringCount - 1);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1b1e26';
  ctx.fillRect(0, 0, width, height);

  const visible = layout.bars.filter((b) => b.x + b.width - scroll >= 0 && b.x - scroll <= width);

  const loop = options.loop;
  if (loop) {
    const first = stripBarFor(layout, loop.startBar);
    const last = stripBarFor(layout, loop.endBar);
    if (first && last) {
      ctx.fillStyle = 'rgba(77, 171, 247, 0.22)';
      ctx.fillRect(first.x - scroll, 0, last.x + last.width - first.x, height);
    }
  }

  ctx.strokeStyle = theme.laneLine;
  ctx.lineWidth = 1;
  for (let s = 0; s < layout.stringCount; s++) {
    const y = layout.lineTop + s * layout.lineGap;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // The cursor goes behind the fret numbers so it never hides the note being played.
  ctx.strokeStyle = '#ffd43b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(layout.cursorX, layout.lineTop - 14);
  ctx.lineTo(layout.cursorX, bottom + 30);
  ctx.stroke();

  ctx.font = '12px system-ui, sans-serif';
  for (const bar of visible) {
    const x = bar.x - scroll;
    ctx.strokeStyle = bar.repeatStart ? theme.strikeline : theme.laneLine;
    ctx.lineWidth = bar.repeatStart ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, layout.lineTop);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    if (bar.repeatEnd) {
      ctx.strokeStyle = theme.strikeline;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + bar.width, layout.lineTop);
      ctx.lineTo(x + bar.width, bottom);
      ctx.stroke();
    }
    ctx.fillStyle = theme.barLabel;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(bar.scoreBar + 1), x + 4, layout.lineTop - 6);
    drawBarNotes(ctx, bar, layout, theme, scroll, bottom);
  }

  ctx.restore();
}

function drawBarNotes(
  ctx: DrawContext,
  bar: StripBar,
  layout: StripLayout,
  theme: HighwayTheme,
  scroll: number,
  staffBottom: number,
): void {
  const seconds = bar.playback.endSeconds - bar.playback.startSeconds;
  const noteX = (n: NoteEvent) => bar.x - scroll + ((n.startSeconds - bar.playback.startSeconds) / seconds) * bar.width + 8;
  ctx.font = '13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const stemmed = new Map<number, NoteEvent>();
  for (const n of bar.notes) {
    const x = noteX(n);
    const y = layout.lineTop + (n.string - 1) * layout.lineGap;
    const label = fretLabel(n);
    // break the string behind the number so it stays readable
    ctx.fillStyle = '#1b1e26';
    ctx.fillRect(x - 7, y - 8, 14, 16);
    ctx.fillStyle = STRIP_NOTE_TEXT;
    ctx.fillText(label, x, y);
    const mark = techniqueMark(n);
    if (mark) {
      ctx.fillStyle = theme.barLabel;
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(mark, x, y - 11);
      ctx.font = '13px system-ui, sans-serif';
    }
    if (!stemmed.has(n.tick)) stemmed.set(n.tick, n);
  }
  // rhythm stems under the staff: one flag per halving below a quarter note
  ctx.strokeStyle = theme.barLabel;
  ctx.lineWidth = 1;
  for (const n of stemmed.values()) {
    if (n.durationTicks >= 3840) continue;
    const x = noteX(n);
    ctx.beginPath();
    ctx.moveTo(x, staffBottom + 8);
    ctx.lineTo(x, staffBottom + 24);
    ctx.stroke();
    const flags = n.durationTicks >= 960 ? 0 : Math.round(Math.log2(960 / n.durationTicks));
    for (let f = 0; f < Math.min(flags, 3); f++) {
      ctx.beginPath();
      ctx.moveTo(x, staffBottom + 24 - f * 4);
      ctx.lineTo(x + 6, staffBottom + 20 - f * 4);
      ctx.stroke();
    }
  }
}
