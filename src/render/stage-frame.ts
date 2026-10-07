import type { PanelId } from '../app/stage-layout';
import type { Timeline } from '../model/score';
import { renderBarTimeline } from './bar-timeline';
import { DEFAULT_LABEL_MODE, renderFretboard, type LabelMode } from './fretboard';
import { DEFAULT_LOOKAHEAD } from './fretboard-steps';
import { renderHighway } from './highway';
import { renderNeckFrame, type PhotoContext } from './neck-view';
import { renderTabStrip, type LoopBars } from './tab-strip';

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
  options: ExportViewOptions & { loop?: LoopBars | null; photo?: CanvasImageSource | null } = { lookahead: DEFAULT_LOOKAHEAD },
): void {
  const lookahead = options.lookahead;
  const labelMode = options.labelMode ?? DEFAULT_LABEL_MODE;
  const layout = frameLayout(height, panels.length, !panels.includes('tab'));

  ctx.save();
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, width, height);

  panels.forEach((panel, i) => {
    const { top, height: h } = layout.panels[i];
    region(ctx, top, width, h, () => {
      switch (panel) {
        case 'highway':
          renderHighway(ctx, timeline, trackIndex, t, width, h);
          break;
        case 'tab':
          renderTabStrip(ctx, timeline, trackIndex, t, width, h, { loop: options.loop });
          break;
        case 'fretboard':
          renderFretboard(ctx, timeline, trackIndex, t, width, h, { lookahead, labelMode });
          break;
        case 'neck':
          renderNeckFrame(ctx, options.photo ?? null, timeline, trackIndex, t, width, h, {
            zoom: true,
            lookahead,
            labelMode,
            techniqueCues: options.neckCues ?? true,
          });
          break;
      }
    });
  });
  const bar = layout.bar;
  if (bar) {
    region(ctx, bar.top, width, bar.height, () => renderBarTimeline(ctx, timeline, t, width, bar.height, { loop: options.loop }));
  }

  ctx.restore();
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
