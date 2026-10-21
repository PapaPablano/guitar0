import { describe, expect, it } from 'vitest';
import type { PanelId } from '../../src/app/stage-layout';
import { computeLayout, timeToX } from '../../src/render/layout';
import { momentAt } from '../../src/render/moment';
import { renderHighway } from '../../src/render/highway';
import { renderTabStrip } from '../../src/render/tab-strip';
import { frameLayout, renderStageFrame, tabColumnZoom, usesWaterfallColumns, waterfallColumns, type FrameContext } from '../../src/render/stage-frame';
import { drawTurned, WATERFALL_STRIKE_FRACTION, type TurnHost } from '../../src/render/upright';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1080;
const H = 1920;
const LOOKAHEAD = 4;

const specs: NoteSpec[] = [1, 2, 3, 4, 5, 6, 7].map((s, i) => ({ start: s, end: s + 0.5, string: 1 + (i % 6), fret: 2 + i }));
const timeline = makeTimeline(specs, 2, 6);

function frame(panels: PanelId[], t = 2.2, tl = timeline, w = W, h = H, loop: { startBar: number; endBar: number } | null = null): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderStageFrame(ctx as unknown as FrameContext, tl, 0, t, w, h, panels, { lookahead: LOOKAHEAD, photo: null, loop });
  return calls;
}

/** The translate that opens each column: the one right before a quarter-turn counter-clockwise rotate. */
function columnOrigins(calls: Call[]): number[][] {
  const out: number[][] = [];
  calls.forEach((c, i) => {
    if (c.name === 'rotate' && Math.abs((c.args[0] as number) + Math.PI / 2) < 1e-9 && calls[i - 1]?.name === 'translate') {
      out.push(calls[i - 1].args as number[]);
    }
  });
  return out;
}

/** Whether the calls of `needle` appear in `haystack` as one unbroken run. */
function containsRun(haystack: Call[], needle: Call[]): boolean {
  const h = haystack.map((c) => JSON.stringify([c.name, c.args]));
  const n = needle.map((c) => JSON.stringify([c.name, c.args]));
  outer: for (let i = 0; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

describe('when a frame uses waterfall columns', () => {
  it('is for a portrait frame whose views are all the highway or the tab strip', () => {
    expect(usesWaterfallColumns(['highway'], W, H)).toBe(true);
    expect(usesWaterfallColumns(['tab'], W, H)).toBe(true);
    expect(usesWaterfallColumns(['highway', 'tab'], W, H)).toBe(true);
    expect(usesWaterfallColumns(['tab', 'highway'], W, H)).toBe(true);
  });

  it('is not for a landscape frame, or when any view cannot run upright', () => {
    expect(usesWaterfallColumns(['highway', 'tab'], 1920, 1080)).toBe(false);
    expect(usesWaterfallColumns(['highway'], 1920, 1080)).toBe(false);
    expect(usesWaterfallColumns(['highway', 'neck'], W, H)).toBe(false);
    expect(usesWaterfallColumns(['tab', 'fretboard'], W, H)).toBe(false);
    expect(usesWaterfallColumns(['neck'], W, H)).toBe(false);
    expect(usesWaterfallColumns(['pick', 'tab'], W, H)).toBe(false);
  });
});

describe('column layout', () => {
  it('gives a single view the full width, above the bar strip', () => {
    const layout = waterfallColumns(W, H, ['highway']);
    expect(layout.columns).toEqual([{ panel: 'highway', left: 0, width: W }]);
    const rows = frameLayout(H, 1, true);
    expect(layout.top).toBe(0);
    expect(layout.height).toBe(rows.panels[0].height);
    expect(layout.bar).toEqual(rows.bar);
  });

  it('puts the highway on the left and the tab strip on the right whichever was chosen first, with no bar strip', () => {
    for (const panels of [['highway', 'tab'], ['tab', 'highway']] as PanelId[][]) {
      const layout = waterfallColumns(W, H, panels);
      expect(layout.columns.map((c) => c.panel)).toEqual(['highway', 'tab']);
      expect(layout.columns[0].left).toBe(0);
      expect(layout.columns[1].left).toBeGreaterThan(W / 2);
      expect(layout.columns[1].left + layout.columns[1].width).toBe(W);
      expect(layout.columns[0].left + layout.columns[0].width).toBeLessThan(layout.columns[1].left);
      expect(layout.bar).toBeNull();
      expect(layout.height).toBe(H);
    }
  });
});

describe('tab column type size', () => {
  it('draws the tab larger in a column than in a landscape panel, up to a limit, and never smaller', () => {
    expect(tabColumnZoom(100)).toBe(1);
    expect(tabColumnZoom(535)).toBeCloseTo(535 / 300, 9);
    expect(tabColumnZoom(1080)).toBe(2.5);
  });

  it('scales the tab drawing in its column but not the highway', () => {
    const calls = frame(['highway', 'tab']);
    const scales = calls.filter((c) => c.name === 'scale');
    expect(scales).toHaveLength(1);
    expect(scales[0].args[0]).toBeCloseTo(tabColumnZoom(waterfallColumns(W, H, ['highway', 'tab']).columns[1].width), 9);
  });
});

describe('a portrait frame with waterfall columns', () => {
  it('draws the highway alone as one full-width column above the bar strip', () => {
    const calls = frame(['highway']);
    const rows = frameLayout(H, 1, true);
    expect(columnOrigins(calls)).toEqual([[0, rows.panels[0].height]]);
    // the bar strip is the region translated to below the column
    expect(calls.some((c) => c.name === 'translate' && c.args[0] === 0 && c.args[1] === rows.bar!.top)).toBe(true);
  });

  it('draws highway plus tab strip as two columns and no bar strip', () => {
    const calls = frame(['highway', 'tab']);
    const layout = waterfallColumns(W, H, ['highway', 'tab']);
    expect(columnOrigins(calls)).toEqual(layout.columns.map((c) => [c.left, layout.top + layout.height]));
    const rows = frameLayout(H, 1, true);
    expect(calls.some((c) => c.name === 'translate' && c.args[0] === 0 && c.args[1] === rows.bar!.top)).toBe(false);
  });

  it('draws the same frame whichever order the views were chosen in', () => {
    expect(frame(['tab', 'highway'])).toEqual(frame(['highway', 'tab']));
  });

  it('draws the highway in the left column and the tab strip in the right, each with the shared strike position', () => {
    const t = 2.2;
    const layout = waterfallColumns(W, H, ['highway', 'tab']);
    const moment = momentAt(timeline, 0, t, { lookahead: LOOKAHEAD, loop: null });
    const highwayRun = createRecordingContext();
    const [left, right] = layout.columns;
    const column = (c: { left: number; width: number }) => ({ left: c.left, top: layout.top, width: c.width, height: layout.height });
    drawTurned(highwayRun.ctx as unknown as TurnHost, column(left), (c, w, h) =>
      renderHighway(c, timeline, 0, t, w, h, { moment, strikeFraction: WATERFALL_STRIKE_FRACTION }),
    );
    const tabRun = createRecordingContext();
    drawTurned(
      tabRun.ctx as unknown as TurnHost,
      column(right),
      (c, w, h) => renderTabStrip(c, timeline, 0, t, w, h, { loop: null, moment, strikeFraction: WATERFALL_STRIKE_FRACTION }),
      tabColumnZoom(right.width),
    );

    const calls = frame(['highway', 'tab'], t);
    expect(containsRun(calls, highwayRun.calls)).toBe(true);
    expect(containsRun(calls, tabRun.calls)).toBe(true);
  });

  it('draws fret numbers in both columns as upright text carrying the note\'s fret', () => {
    const calls = frame(['highway', 'tab'], 1.1);
    // note 0 is fret 2 on string 1; it is sounding at 1.1, so both columns label it
    const at = (i: number) => calls.slice(Math.max(0, i - 3), i + 2).map((c) => c.name);
    const labels = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.name === 'fillText' && c.args[0] === '2');
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const { i } of labels) expect(at(i)).toEqual(expect.arrayContaining(['rotate']));
  });

  it('draws a long sustain as a tail that runs away from the strikeline along the time axis, in turned space', () => {
    const t = 1.2;
    const tl = makeTimeline([{ start: 1, end: 2.5, string: 2, fret: 5 }], 2, 4);
    const calls = frame(['highway'], t, tl);
    const rows = frameLayout(H, 1, true);
    const layout = computeLayout(rows.panels[0].height, W, 6, undefined, WATERFALL_STRIKE_FRACTION);
    const tail = calls.filter((c) => c.name === 'fillRect' && c.alpha === 0.55);
    expect(tail).toHaveLength(1);
    expect(tail[0].args[0]).toBeCloseTo(layout.strikeX, 6);
    expect(tail[0].args[2]).toBeCloseTo(timeToX(layout, 2.5, t) - layout.strikeX, 6);
    expect(tail[0].args[2] as number).toBeGreaterThan(layout.noteRadius * 2);
  });

  it('lays out as many lanes as the track has strings', () => {
    const bass = makeTimeline([{ start: 1, end: 1.5, string: 4, fret: 3 }], 2, 4, 4);
    const calls = frame(['highway'], 1.2, bass);
    const tints = calls.filter((c) => c.name === 'fillRect' && c.alpha === 0.07);
    expect(tints).toHaveLength(4);
  });

  it('draws the tab strip alone as one full-width column with no bar strip', () => {
    const calls = frame(['tab']);
    expect(columnOrigins(calls)).toEqual([[0, H]]);
    const rows = frameLayout(H, 1, true);
    expect(calls.some((c) => c.name === 'translate' && c.args[0] === 0 && c.args[1] === rows.bar!.top)).toBe(false);
  });

  it('passes the loop through to the tab column', () => {
    const plain = frame(['highway', 'tab'], 2.2);
    const looped = frame(['highway', 'tab'], 2.2, timeline, W, H, { startBar: 0, endBar: 1 });
    expect(looped).not.toEqual(plain);
    // the loop wash is a translucent blue fill drawn in the tab column
    expect(looped.some((c) => c.name === 'set:fillStyle' && c.args[0] === 'rgba(77, 171, 247, 0.22)')).toBe(true);
    expect(plain.some((c) => c.name === 'set:fillStyle' && c.args[0] === 'rgba(77, 171, 247, 0.22)')).toBe(false);
  });

  it('draws a timeline with no notes without error', () => {
    const empty = makeTimeline([], 2, 4);
    expect(() => frame(['highway', 'tab'], 0.5, empty)).not.toThrow();
  });
});

describe('technique-mark labels in a tab column', () => {
  it('stay turned with the strip while fret numbers are counter-turned', () => {
    const tl = makeTimeline(
      [
        { start: 1, end: 1.5, string: 1, fret: 7, techniques: { bend: 1 } },
        { start: 1, end: 1.5, string: 2, fret: 7, techniques: { harmonic: true } },
        { start: 1, end: 1.5, string: 3, fret: 7, techniques: { palmMute: true } },
      ],
      2,
      4,
    );
    const calls = frame(['tab'], 1.1, tl);
    const texts = calls.map((c, i) => ({ c, i })).filter(({ c }) => c.name === 'fillText');
    // a counter-turned text is drawn at the origin right after a rotate; a turned one is not
    const counterTurned = texts.filter(({ c, i }) => c.args[1] === 0 && c.args[2] === 0 && calls[i - 1]?.name === 'rotate');
    const turned = texts.filter(({ c, i }) => !(c.args[1] === 0 && c.args[2] === 0 && calls[i - 1]?.name === 'rotate'));
    expect(counterTurned.some(({ c }) => c.args[0] === '7')).toBe(true);
    // one label for each of the three marked notes, none of them a fret number
    expect(turned.length).toBeGreaterThanOrEqual(3);
    expect(turned.every(({ c }) => c.args[0] !== '7')).toBe(true);
  });
});

describe('frames that keep today\'s layout', () => {
  it('stack a portrait highway plus Real guitar in rows, with no quarter-turn column', () => {
    expect(columnOrigins(frame(['highway', 'neck']))).toEqual([]);
  });

  it('stack a landscape highway plus tab strip in rows, with no quarter-turn column', () => {
    expect(columnOrigins(frame(['highway', 'tab'], 2.2, timeline, 1920, 1080))).toEqual([]);
  });
});
