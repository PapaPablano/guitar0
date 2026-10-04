import { renderBarTimeline } from './bar-timeline';
import type { DrawContext } from './draw-context';
import { renderFretboard } from './fretboard';
import { DEFAULT_LOOKAHEAD } from './fretboard-steps';
import { renderHighway } from './highway';
import { renderTabStrip, type LoopBars } from './tab-strip';
import type { Timeline } from '../model/score';

/** Share of the frame given to the highway; the bottom view takes the rest. */
export const HIGHWAY_SHARE = 0.62;

export type BottomView = 'tab' | 'fretboard';

/** Which view fills the bottom of the frame, and how many steps ahead the fretboard shows. */
export interface BottomOptions {
  readonly view: BottomView;
  readonly lookahead: number;
}

/** Extra drawing calls a surface needs to place a sub-region; canvases provide these. */
export interface CompositeContext extends DrawContext {
  translate(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
}

/** Heights of the frame's regions; the export tests use the same numbers. */
export function frameLayout(height: number) {
  const highwayHeight = Math.round(height * HIGHWAY_SHARE);
  const gap = Math.round(height * 0.01);
  const bottomTop = highwayHeight + gap;
  const bottomHeight = height - bottomTop;
  const timelineHeight = Math.max(28, Math.round(height * 0.035));
  return {
    highwayHeight,
    gap,
    bottomTop,
    bottomHeight,
    timelineHeight,
    fretboardHeight: bottomHeight - timelineHeight - gap,
  };
}

/**
 * Draws the whole practice screen (highway over the tab strip or the fretboard) for time `t`. The
 * video export draws every frame through this function, so a frame matches what the preview shows
 * at that time.
 */
export function renderComposite(
  ctx: CompositeContext,
  timeline: Timeline,
  trackIndex: number,
  t: number,
  width: number,
  height: number,
  options: { loop?: LoopBars | null; bottom?: BottomOptions } = {},
): void {
  const view = options.bottom?.view ?? 'tab';
  const lookahead = options.bottom?.lookahead ?? DEFAULT_LOOKAHEAD;
  const { highwayHeight, gap, bottomTop, bottomHeight, timelineHeight, fretboardHeight } = frameLayout(height);

  ctx.save();
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, width, height);

  region(ctx, 0, width, highwayHeight, () => renderHighway(ctx, timeline, trackIndex, t, width, highwayHeight));

  if (view === 'fretboard') {
    region(ctx, bottomTop, width, fretboardHeight, () =>
      renderFretboard(ctx, timeline, trackIndex, t, width, fretboardHeight, { lookahead }),
    );
    region(ctx, bottomTop + fretboardHeight + gap, width, timelineHeight, () =>
      renderBarTimeline(ctx, timeline, t, width, timelineHeight, { loop: options.loop }),
    );
  } else {
    region(ctx, bottomTop, width, bottomHeight, () =>
      renderTabStrip(ctx, timeline, trackIndex, t, width, bottomHeight, { loop: options.loop }),
    );
  }

  ctx.restore();
}

/** Runs `draw` inside a clipped rectangle that starts at `top`, with its own origin there (none to move for the top region). */
function region(ctx: CompositeContext, top: number, width: number, height: number, draw: () => void): void {
  ctx.save();
  if (top !== 0) ctx.translate(0, top);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  draw();
  ctx.restore();
}
