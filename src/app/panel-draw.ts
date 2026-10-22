import { barAtX, getBarTimelineLayout, renderBarTimeline } from '../render/bar-timeline';
import { renderFretboard, type LabelMode } from '../render/fretboard';
import { renderHighway } from '../render/highway';
import { momentAt, type Moment } from '../render/moment';
import { renderNeckFrame } from '../render/neck-view';
import { neckPhotoKind, neckProfileFor, PICK_PROFILE } from '../render/neck-profile';
import { getStripLayout, renderTabStrip, scoreBarAtX, type LoopBars } from '../render/tab-strip';
import type { Timeline } from '../model/score';
import { fitCanvas } from './canvas-fit';
import { PANEL_NAMES, type PanelId } from './stage-layout';
import type { PickPhoto } from './use-pick-photo';

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
  /** The bass photo the Real guitar view draws a 4-string track on; none until it has loaded when absent. */
  readonly bassPhoto?: HTMLImageElement | null;
  /** The pick view's photo and profile; its bundled profile with no photo until it has loaded when absent. */
  readonly pickPhoto?: PickPhoto | null;
  /** The frame's shared moment, built once per frame; each surface builds its own from the other fields when absent. */
  readonly moment?: Moment;
}

/** The moment for a frame: build it once and put it in the draw state so every surface draws from the same one. */
export function frameMoment(s: Omit<PanelDrawState, 'moment'>): Moment {
  return momentAt(s.timeline, s.trackIndex, s.t, { lookahead: s.lookahead, loop: s.loop });
}

/** A frame's draw state with its moment built once, for the loops that draw every surface of a frame. */
export function withMoment(s: Omit<PanelDrawState, 'moment'>): PanelDrawState {
  return { ...s, moment: frameMoment(s) };
}

export const SURFACE_NAMES: Record<SurfaceKind, string> = { ...PANEL_NAMES, bar: 'Bar timeline' };

/** Draws one surface into its canvas, sized to its box. The page and the full-screen view both draw through this. */
export function drawSurface(kind: SurfaceKind, canvas: HTMLCanvasElement, s: PanelDrawState): void {
  const fit = fitCanvas(canvas);
  if (!fit) return;
  const { ctx, width, height } = fit;
  const moment = s.moment ?? frameMoment(s);
  switch (kind) {
    case 'highway':
      renderHighway(ctx, s.timeline, s.trackIndex, s.t, width, height, { moment });
      break;
    case 'tab':
      renderTabStrip(ctx, s.timeline, s.trackIndex, s.t, width, height, { loop: s.loop, moment });
      break;
    case 'fretboard':
      renderFretboard(ctx, s.timeline, s.trackIndex, s.t, width, height, { lookahead: s.lookahead, labelMode: s.labelMode, moment });
      break;
    case 'neck': {
      const strings = s.timeline.tracks[s.trackIndex]?.stringCount ?? 6;
      renderNeckFrame(ctx, neckPhotoKind(strings) === 'bass' ? s.bassPhoto ?? null : s.photo, s.timeline, s.trackIndex, s.t, width, height, {
        zoom: true,
        lookahead: s.lookahead,
        labelMode: s.labelMode,
        techniqueCues: s.neckCues,
        profile: neckProfileFor(strings),
        moment,
      });
      break;
    }
    case 'pick':
      renderNeckFrame(ctx, s.pickPhoto?.image ?? null, s.timeline, s.trackIndex, s.t, width, height, {
        zoom: true,
        lookahead: s.lookahead,
        labelMode: s.labelMode,
        techniqueCues: s.neckCues,
        profile: s.pickPhoto?.profile ?? PICK_PROFILE,
        moment,
      });
      break;
    case 'bar':
      renderBarTimeline(ctx, s.timeline, s.t, width, height, { loop: s.loop, moment });
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
