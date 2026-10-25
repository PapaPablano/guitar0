import type { PanelId } from '../app/stage-layout';
import type { Timeline } from '../model/score';
import { renderBarTimeline } from './bar-timeline';
import { DEFAULT_LABEL_MODE, renderFretboard, type LabelMode } from './fretboard';
import { DEFAULT_LOOKAHEAD } from './fretboard-steps';
import { renderHighway } from './highway';
import { momentAt, type Moment } from './moment';
import { bassPickProfileFor, neckPhotoKind, neckProfileFor, PICK_PROFILE, type NeckProfile } from './neck-profile';
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

export type FrameOptions = ExportViewOptions & {
  loop?: LoopBars | null;
  /** The Real guitar view's photo: the guitar photo, or the bass photo when that is the only one given and the track has 4 strings. */
  photo?: CanvasImageSource | null;
  /** The bass photo, for a panel whose track has 4 strings; `photo` stands in when absent. */
  bassPhoto?: CanvasImageSource | null;
  /** The pick view's photo and the profile it was measured with; its bundled profile with no photo when absent. */
  pickPhoto?: { readonly photo: CanvasImageSource | null; readonly profile: NeckProfile } | null;
};

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

/** The views that can run top to bottom as a column: the highway and tab strip turned, the two guitar views already upright on a tall screen. */
type ColumnPanel = 'highway' | 'tab' | 'neck' | 'pick';
const COLUMN_PANELS: readonly ColumnPanel[] = ['highway', 'tab', 'neck', 'pick'];

export interface WaterfallColumn {
  readonly panel: ColumnPanel;
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

/** A portrait frame whose views can all be drawn upright (the highway, the tab strip and the two guitar views) lays them out as columns. */
export function usesWaterfallColumns(panels: readonly PanelId[], width: number, height: number): boolean {
  return height > width && panels.length > 0 && panels.every((p) => (COLUMN_PANELS as readonly string[]).includes(p));
}

/** Side-by-side columns above the bar strip: the waterfalls on the left (highway, then tab strip) and the guitar on the right, whichever was chosen first. */
export function waterfallColumns(width: number, height: number, panels: readonly PanelId[]): WaterfallLayout {
  const rows = frameLayout(height, 1, !panels.includes('tab'));
  const shown = COLUMN_PANELS.filter((p) => panels.includes(p));
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
  trackIndex: number | readonly number[],
  t: number,
  width: number,
  height: number,
  panels: readonly PanelId[],
  options: FrameOptions = { lookahead: DEFAULT_LOOKAHEAD },
): void {
  const lookahead = options.lookahead;
  const labelMode = options.labelMode ?? DEFAULT_LABEL_MODE;
  const columns = usesWaterfallColumns(panels, width, height);
  const layout = frameLayout(height, columns ? 1 : panels.length, !panels.includes('tab'));
  // The track each panel draws: one number means every panel draws it.
  const tracks = panels.map((_, i) => (typeof trackIndex === 'number' ? trackIndex : trackIndex[i] ?? trackIndex[0] ?? 0));
  // One moment per distinct track, so panels on the same track agree on what is sounding.
  const moments = new Map<number, Moment>();
  const momentOf = (track: number): Moment => {
    let m = moments.get(track);
    if (!m) {
      m = momentAt(timeline, track, t, { lookahead, loop: options.loop });
      moments.set(track, m);
    }
    return m;
  };

  ctx.save();
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, width, height);

  if (columns) drawWaterfallColumns(ctx, timeline, tracks, t, width, height, panels, momentOf, options);

  if (!columns) panels.forEach((panel, i) => {
    const { top, height: h } = layout.panels[i];
    const track = tracks[i];
    const moment = momentOf(track);
    region(ctx, top, width, h, () => {
      switch (panel) {
        case 'highway':
          renderHighway(ctx, timeline, track, t, width, h, { moment });
          break;
        case 'tab':
          renderTabStrip(ctx, timeline, track, t, width, h, { loop: options.loop, moment });
          break;
        case 'fretboard':
          renderFretboard(ctx, timeline, track, t, width, h, { lookahead, labelMode, moment });
          break;
        case 'neck':
        case 'pick':
          drawGuitar(ctx, panel, timeline, track, t, width, h, moment, options);
          break;
      }
    });
  });
  const bar = layout.bar;
  if (bar) {
    region(ctx, bar.top, width, bar.height, () => renderBarTimeline(ctx, timeline, t, width, bar.height, { loop: options.loop, moment: momentOf(tracks[0] ?? 0) }));
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
  tracks: readonly number[],
  t: number,
  width: number,
  height: number,
  panels: readonly PanelId[],
  momentOf: (track: number) => Moment,
  options: FrameOptions,
): void {
  const loop = options.loop;
  const layout = waterfallColumns(width, height, panels);
  for (const column of layout.columns) {
    const rect = { left: column.left, top: layout.top, width: column.width, height: layout.height };
    const trackIndex = tracks[panels.indexOf(column.panel)] ?? tracks[0] ?? 0;
    const moment = momentOf(trackIndex);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    if (column.panel === 'highway') {
      drawTurned(ctx, rect, (turned, w, h) =>
        renderHighway(turned, timeline, trackIndex, t, w, h, { moment, strikeFraction: WATERFALL_STRIKE_FRACTION }),
      );
    } else if (column.panel === 'neck' || column.panel === 'pick') {
      // already upright on a tall surface: the photo turns itself so the headstock is at the top
      ctx.translate(rect.left, rect.top);
      drawGuitar(ctx, column.panel, timeline, trackIndex, t, rect.width, rect.height, moment, options);
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

/** The Real guitar view or the pick view, filling a `width` x `height` area at the origin. A 4-string track draws on the bass photo, any other on the guitar photo. */
function drawGuitar(
  ctx: FrameContext,
  panel: 'neck' | 'pick',
  timeline: Timeline,
  track: number,
  t: number,
  width: number,
  height: number,
  moment: Moment,
  options: FrameOptions,
): void {
  const strings = timeline.tracks[track]?.stringCount ?? 6;
  const neckPhoto = neckPhotoKind(strings) === 'bass' ? options.bassPhoto ?? options.photo ?? null : options.photo ?? null;
  const shared = { zoom: true, lookahead: options.lookahead, labelMode: options.labelMode ?? DEFAULT_LABEL_MODE, techniqueCues: options.neckCues ?? true, moment };
  if (panel === 'neck') {
    renderNeckFrame(ctx, neckPhoto, timeline, track, t, width, height, { ...shared, profile: neckProfileFor(strings) });
    return;
  }
  // a 4-string track's pick view is drawn on the bass photo, which travels with the neck view's photo
  const bassProfile = bassPickProfileFor(strings);
  renderNeckFrame(ctx, bassProfile ? neckPhoto : options.pickPhoto?.photo ?? null, timeline, track, t, width, height, {
    ...shared,
    profile: bassProfile ?? options.pickPhoto?.profile ?? PICK_PROFILE,
  });
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
