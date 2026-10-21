import type { PanelId } from '../app/stage-layout';
import type { Timeline } from '../model/score';
import { renderBarTimeline } from './bar-timeline';
import { DEFAULT_LABEL_MODE, renderFretboard, type LabelMode } from './fretboard';
import { DEFAULT_LOOKAHEAD } from './fretboard-steps';
import { renderHighway } from './highway';
import { momentAt, type Moment } from './moment';
import { PICK_PROFILE, type NeckProfile } from './neck-profile';
import { renderNeckFrame, type PhotoContext } from './neck-view';
import { renderTabStrip, type LoopBars } from './tab-strip';
import { drawTurned, WATERFALL_STRIKE_FRACTION } from './upright';

/** What the video shows besides which panels: the look-ahead, the dot labels and the technique cues. */
export interface ExportViewOptions {
  readonly lookahead: number;
  readonly labelMode?: LabelMode;
  /** Whether the real guitar draws technique cues; absent means yes. */
  readonly neckCues?: boolean;
}

/** Extra drawing calls a frame needs to place a sub-region; canvases provide these. */
export interface FrameContext extends PhotoContext {
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
}

export interface FrameLayout {
  /** Top and height of each panel, in order. */
  readonly panels: readonly { readonly top: number; readonly height: number }[];
  /** The slim bar strip that stands in for the tab strip's seeking, when the tab strip is not shown. */
  readonly bar: { readonly top: number; readonly height: number } | null;
}

/** Like the page: the panels share the height equally, and a slim bar strip sits under them when no panel is the tab strip. */
export function frameLayout(height: number, panelCount: number, withBar: boolean): FrameLayout {
  const gap = Math.round(height * 0.01);
  const barHeight = withBar ? Math.max(28, Math.round(height * 0.035)) : 0;
  const room = height - (withBar ? barHeight + gap : 0) - gap * (panelCount - 1);
  const each = Math.floor(room / panelCount);
  const panels = Array.from({ length: panelCount }, (_, i) => ({
    top: i * (each + gap),
    height: i === panelCount - 1 ? room - each * (panelCount - 1) : each,
  }));
  const last = panels[panels.length - 1];
  return { panels, bar: withBar ? { top: last.top + last.height + gap, height: barHeight } : null };
}

export interface WaterfallColumn {
  readonly panel: 'highway' | 'tab';
  readonly left: number;
  readonly width: number;
}

export interface WaterfallLayout {
  /** The columns share this band: from `top`, `height` tall, with the bar strip (when shown) under it. */
  readonly top: number;
  readonly height: number;
  readonly columns: readonly WaterfallColumn[];
  readonly bar: FrameLayout['bar'];
}

/** A portrait frame whose views can all be drawn upright (the highway and the tab strip) lays them out as waterfall columns. */
export function usesWaterfallColumns(panels: readonly PanelId[], width: number, height: number): boolean {
  return height > width && panels.length > 0 && panels.every((p) => p === 'highway' || p === 'tab');
}

/** Side-by-side columns above the bar strip: the highway on the left and the tab strip on the right, whichever was chosen first. */
export function waterfallColumns(width: number, height: number, panels: readonly PanelId[]): WaterfallLayout {
  const rows = frameLayout(height, 1, !panels.includes('tab'));
  const shown = (['highway', 'tab'] as const).filter((p) => panels.includes(p));
  const gap = Math.round(width * 0.01);
  const each = Math.floor((width - gap * (shown.length - 1)) / shown.length);
  const columns = shown.map((panel, i) => {
    const left = i * (each + gap);
    return { panel, left, width: i === shown.length - 1 ? width - left : each };
  });
  return { top: rows.panels[0].top, height: rows.panels[0].height, columns, bar: rows.bar };
}

/**
 * Draws the whole video frame for time `t`: the chosen panels, one over the other, as the page shows them.
 * The video export draws every frame through this function, so a frame matches what the page shows at that time.
 */
export function renderStageFrame(
  ctx: FrameContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  panels: readonly PanelId[],
  options: ExportViewOptions & {
    loop?: LoopBars | null;
    photo?: CanvasImageSource | null;
    /** The pick view's photo and the profile it was measured with; its bundled profile with no photo when absent. */
    pickPhoto?: { readonly photo: CanvasImageSource | null; readonly profile: NeckProfile } | null;
  } = { lookahead: DEFAULT_LOOKAHEAD },
): void {
  const lookahead = options.lookahead;
  const labelMode = options.labelMode ?? DEFAULT_LABEL_MODE;
  const columns = usesWaterfallColumns(panels, width, height);
  const layout = frameLayout(height, columns ? 1 : panels.length, !panels.includes('tab'));
  // One moment for the whole frame, so every panel agrees on what is sounding.
  const moment = momentAt(timeline, trackIndex, t, { lookahead, loop: options.loop });

  ctx.save();
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, width, height);

  if (columns) drawWaterfallColumns(ctx, timeline, trackIndex, t, width, height, panels, moment, options.loop);

  if (!columns) panels.forEach((panel, i) => {
    const { top, height: h } = layout.panels[i];
    region(ctx, top, width, h, () => {
      switch (panel) {
        case 'highway':
          renderHighway(ctx, timeline, trackIndex, t, width, h, { moment });
          break;
        case 'tab':
          renderTabStrip(ctx, timeline, trackIndex, t, width, h, { loop: options.loop, moment });
          break;
        case 'fretboard':
          renderFretboard(ctx, timeline, trackIndex, t, width, h, { lookahead, labelMode, moment });
          break;
        case 'neck':
          renderNeckFrame(ctx, options.photo ?? null, timeline, trackIndex, t, width, h, {
            zoom: true,
            lookahead,
            labelMode,
            techniqueCues: options.neckCues ?? true,
            moment,
          });
          break;
        case 'pick':
          renderNeckFrame(ctx, options.pickPhoto?.photo ?? null, timeline, trackIndex, t, width, h, {
            zoom: true,
            lookahead,
            labelMode,
            techniqueCues: options.neckCues ?? true,
            profile: options.pickPhoto?.profile ?? PICK_PROFILE,
            moment,
          });
          break;
      }
    });
  });
  const bar = layout.bar;
  if (bar) {
    region(ctx, bar.top, width, bar.height, () => renderBarTimeline(ctx, timeline, t, width, bar.height, { loop: options.loop, moment }));
  }

  ctx.restore();
}

/** The tab strip's type is sized for a landscape panel, so a column draws it larger: about 300 px across the strings per 1080 px frame width, up to 2.5 times. */
export function tabColumnZoom(columnWidth: number): number {
  return Math.min(2.5, Math.max(1, columnWidth / 300));
}

/** Draws the highway and the tab strip as upright waterfalls, each clipped to its column and sharing one strike position. */
function drawWaterfallColumns(
  ctx: FrameContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  panels: readonly PanelId[],
  moment: Moment,
  loop: LoopBars | null | undefined,
): void {
  const layout = waterfallColumns(width, height, panels);
  for (const column of layout.columns) {
    const rect = { left: column.left, top: layout.top, width: column.width, height: layout.height };
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    if (column.panel === 'highway') {
      drawTurned(ctx, rect, (turned, w, h) =>
        renderHighway(turned, timeline, trackIndex, t, w, h, { moment, strikeFraction: WATERFALL_STRIKE_FRACTION }),
      );
    } else {
      drawTurned(
        ctx,
        rect,
        (turned, w, h) => renderTabStrip(turned, timeline, trackIndex, t, w, h, { loop, moment, strikeFraction: WATERFALL_STRIKE_FRACTION }),
        tabColumnZoom(column.width),
      );
    }
    ctx.restore();
  }
}

/** Runs `draw` inside a clipped rectangle that starts at `top`, with its own origin there (none to move for the top region). */
function region(ctx: FrameContext, top: number, width: number, height: number, draw: () => void): void {
  ctx.save();
  if (top !== 0) ctx.translate(0, top);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  draw();
  ctx.restore();
}
