import { barSpans } from './bars';
import type { DrawContext } from './draw-context';
import { DEFAULT_THEME, type HighwayTheme } from './theme';
import type { LoopBars } from './tab-strip';
import { playbackBarIndexAt } from '../model/bars';
import type { BarEvent, Timeline } from '../model/score';

/** A bar must be at least this wide to carry its number; narrower bars share numbers (every Nth). */
export const MIN_LABEL_WIDTH = 28;

export interface TimelineBar {
  readonly scoreBar: number;
  readonly x: number;
  readonly width: number;
  /** The first time this bar is played. */
  readonly playback: BarEvent;
  readonly repeatStart: boolean;
  readonly repeatEnd: boolean;
}

export interface BarTimelineLayout {
  readonly bars: readonly TimelineBar[];
  readonly width: number;
  readonly height: number;
}

const layoutCache = new WeakMap<Timeline, Map<string, BarTimelineLayout>>();

export function getBarTimelineLayout(timeline: Timeline, width: number, height: number): BarTimelineLayout {
  let bySize = layoutCache.get(timeline);
  if (!bySize) {
    bySize = new Map();
    layoutCache.set(timeline, bySize);
  }
  const key = `${width}:${height}`;
  let layout = bySize.get(key);
  if (!layout) {
    layout = buildBarTimeline(timeline, width, height);
    bySize.set(key, layout);
  }
  return layout;
}

/** Lays every bar across the width in proportion to how long it lasts; nothing scrolls. */
export function buildBarTimeline(timeline: Timeline, width: number, height: number): BarTimelineLayout {
  const spans = barSpans(timeline);
  const total = spans.reduce((sum, s) => sum + (s.playback.endSeconds - s.playback.startSeconds), 0);
  const bars: TimelineBar[] = [];
  let x = 0;
  for (const span of spans) {
    const seconds = span.playback.endSeconds - span.playback.startSeconds;
    const barWidth = total > 0 ? (seconds / total) * width : width / Math.max(1, spans.length);
    bars.push({
      scoreBar: span.scoreBar,
      x,
      width: barWidth,
      playback: span.playback,
      repeatStart: span.repeatStart,
      repeatEnd: span.repeatEnd,
    });
    x += barWidth;
  }
  return { bars, width, height };
}

/** The score bar under an x position, or null outside the bars. */
export function barAtX(layout: BarTimelineLayout, x: number): number | null {
  for (const bar of layout.bars) {
    if (x >= bar.x && x < bar.x + bar.width) return bar.scoreBar;
  }
  return null;
}

/** Playback time at the start of a score bar's first pass. */
export function timelineBarStartSeconds(layout: BarTimelineLayout, scoreBar: number): number | null {
  return layout.bars.find((b) => b.scoreBar === scoreBar)?.playback.startSeconds ?? null;
}

/** X of the playhead. Across a repeat it jumps back to the repeated bar. */
export function timelinePlayheadX(layout: BarTimelineLayout, timeline: Timeline, t: number): number {
  const played = timeline.bars[playbackBarIndexAt(timeline, t)];
  if (!played) return 0;
  const bar = layout.bars.find((b) => b.scoreBar === played.scoreBar);
  if (!bar) return 0;
  const seconds = played.endSeconds - played.startSeconds;
  const fraction = seconds > 0 ? Math.min(1, Math.max(0, (t - played.startSeconds) / seconds)) : 0;
  return bar.x + fraction * bar.width;
}

/** Every Nth bar gets a number so the numbers never collide: N = 1 when bars are wide enough. */
export function labelEvery(layout: BarTimelineLayout): number {
  if (layout.bars.length === 0) return 1;
  const narrowest = Math.min(...layout.bars.map((b) => b.width));
  return Math.max(1, Math.ceil(MIN_LABEL_WIDTH / Math.max(1, narrowest)));
}

export interface BarTimelineOptions {
  readonly theme?: HighwayTheme;
  readonly loop?: LoopBars | null;
}

/** Draws the slim bar timeline: bars, numbers, repeat marks, the loop tint and the playhead. */
export function renderBarTimeline(
  ctx: DrawContext,
  timeline: Timeline,
  t: number,
  width: number,
  height: number,
  options: BarTimelineOptions = {},
): void {
  const theme = options.theme ?? DEFAULT_THEME;
  const layout = getBarTimelineLayout(timeline, width, height);
  const every = labelEvery(layout);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1b1e26';
  ctx.fillRect(0, 0, width, height);

  const loop = options.loop;
  if (loop) {
    const first = layout.bars.find((b) => b.scoreBar === loop.startBar);
    const last = layout.bars.find((b) => b.scoreBar === loop.endBar);
    if (first && last) {
      ctx.fillStyle = 'rgba(77, 171, 247, 0.22)';
      ctx.fillRect(first.x, 0, last.x + last.width - first.x, height);
    }
  }

  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const bar of layout.bars) {
    ctx.strokeStyle = bar.repeatStart ? theme.strikeline : theme.laneLine;
    ctx.lineWidth = bar.repeatStart ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(bar.x, 0);
    ctx.lineTo(bar.x, height);
    ctx.stroke();
    if (bar.repeatEnd) {
      ctx.strokeStyle = theme.strikeline;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bar.x + bar.width, 0);
      ctx.lineTo(bar.x + bar.width, height);
      ctx.stroke();
    }
    if (bar.scoreBar % every === 0) {
      ctx.fillStyle = theme.barLabel;
      ctx.fillText(String(bar.scoreBar + 1), bar.x + 4, height / 2);
    }
  }

  const x = timelinePlayheadX(layout, timeline, t);
  ctx.strokeStyle = '#ffd43b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, height);
  ctx.stroke();
  ctx.restore();
}
