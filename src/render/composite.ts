import type { DrawContext } from './draw-context';
import { renderHighway } from './highway';
import { renderTabStrip, type LoopBars } from './tab-strip';
import type { Timeline } from '../model/score';

/** Share of the frame given to the highway; the tab strip takes the rest. */
export const HIGHWAY_SHARE = 0.62;

/** Extra drawing calls a surface needs to place a sub-region; canvases provide these. */
export interface CompositeContext extends DrawContext {
  translate(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
}

/**
 * Draws the whole practice screen (highway over tab strip) for time `t`. The video export draws
 * every frame through this function, so a frame matches what the preview shows at that time.
 */
export function renderComposite(
  ctx: CompositeContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: { loop?: LoopBars | null } = {},
): void {
  const highwayHeight = Math.round(height * HIGHWAY_SHARE);
  const gap = Math.round(height * 0.01);
  const stripHeight = height - highwayHeight - gap;

  ctx.save();
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, highwayHeight);
  ctx.clip();
  renderHighway(ctx, timeline, trackIndex, t, width, highwayHeight);
  ctx.restore();

  ctx.save();
  ctx.translate(0, highwayHeight + gap);
  ctx.beginPath();
  ctx.rect(0, 0, width, stripHeight);
  ctx.clip();
  renderTabStrip(ctx, timeline, trackIndex, t, width, stripHeight, { loop: options.loop });
  ctx.restore();

  ctx.restore();
}
