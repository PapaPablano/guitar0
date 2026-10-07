import { barAtX, getBarTimelineLayout, renderBarTimeline } from '../render/bar-timeline';
import { renderFretboard, type LabelMode } from '../render/fretboard';
import { renderHighway } from '../render/highway';
import { renderNeckFrame } from '../render/neck-view';
import { getStripLayout, renderTabStrip, scoreBarAtX, type LoopBars } from '../render/tab-strip';
import type { Timeline } from '../model/score';
import { fitCanvas } from './canvas-fit';
import { PANEL_NAMES, type PanelId } from './stage-layout';

/** A drawing surface: one of the panels, or the slim bar strip that stands in for the tab strip's seeking and looping. */
export type SurfaceKind = PanelId | 'bar';

export interface PanelDrawState {
  readonly timeline: Timeline;
  readonly trackIndex: number;
  readonly t: number;
  readonly loop: LoopBars | null;
  readonly lookahead: number;
  readonly labelMode: LabelMode;
  readonly neckCues: boolean;
  readonly photo: HTMLImageElement | null;
}

export const SURFACE_NAMES: Record<SurfaceKind, string> = { ...PANEL_NAMES, bar: 'Bar timeline' };

/** Draws one surface into its canvas, sized to its box. The page and the full-screen view both draw through this. */
export function drawSurface(kind: SurfaceKind, canvas: HTMLCanvasElement, s: PanelDrawState): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, width, height } = fit;
  switch (kind) {
    case 'highway':
      renderHighway(ctx, s.timeline, s.trackIndex, s.t, width, height);
      break;
    case 'tab':
      renderTabStrip(ctx, s.timeline, s.trackIndex, s.t, width, height, { loop: s.loop });
      break;
    case 'fretboard':
      renderFretboard(ctx, s.timeline, s.trackIndex, s.t, width, height, { lookahead: s.lookahead, labelMode: s.labelMode });
      break;
    case 'neck':
      renderNeckFrame(ctx, s.photo, s.timeline, s.trackIndex, s.t, width, height, {
        zoom: true,
        lookahead: s.lookahead,
        labelMode: s.labelMode,
        techniqueCues: s.neckCues,
      });
      break;
    case 'bar':
      renderBarTimeline(ctx, s.timeline, s.t, width, height, { loop: s.loop });
      break;
  }
}

/** What a screen reader hears for a surface: its name, the bar being played and the track. */
export function surfaceLabel(kind: SurfaceKind, timeline: Timeline, trackIndex: number, playbackBar: number): string {
  const bar = timeline.bars[playbackBar]?.scoreBar;
  const track = timeline.tracks[trackIndex]?.name || trackIndex + 1;
  return `${SURFACE_NAMES[kind]}, bar ${bar === undefined ? 1 : bar + 1} of ${timeline.scoreBarCount}, track ${track}`;
}

/** The score bar under a pointer on the tab strip or the bar strip; a drag past the edge picks the nearest end bar. */
export function barAtPointer(
  kind: 'tab' | 'bar',
  canvas: HTMLCanvasElement,
  clientX: number,
  timeline: Timeline,
  trackIndex: number,
  t: number,
): number | null {
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const x = clientX - rect.left;
  if (kind === 'bar') {
    const inside = Math.min(Math.max(x, 0), width - 0.001);
    return barAtX(getBarTimelineLayout(timeline, width, height), inside);
  }
  return scoreBarAtX(getStripLayout(timeline, trackIndex, width, height), timeline, t, x);
}
