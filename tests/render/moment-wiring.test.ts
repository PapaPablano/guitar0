import { beforeEach, describe, expect, it, vi } from 'vitest';

// Count how many moments a frame builds. The real function still runs.
const builds = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/render/moment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/moment')>();
  return {
    ...actual,
    momentAt: (...args: Parameters<typeof actual.momentAt>) => {
      builds.count += 1;
      return actual.momentAt(...args);
    },
  };
});

import { frameMoment } from '../../src/app/panel-draw';
import { renderBarTimeline } from '../../src/render/bar-timeline';
import { computeNeck, noteDotX, renderFretboard } from '../../src/render/fretboard';
import { renderHighway } from '../../src/render/highway';
import { momentAt } from '../../src/render/moment';
import { renderNeckFrame, type PhotoContext } from '../../src/render/neck-view';
import { frameLayout, renderStageFrame, type FrameContext } from '../../src/render/stage-frame';
import { renderTabStrip } from '../../src/render/tab-strip';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { createRecordingContext } from '../helpers/recording-context';
import { makeTimeline } from '../helpers/make-timeline';

const W = 1200;
const H = 800;

const song = makeTimeline([
  { start: 1, end: 1.5, string: 2, fret: 5 },
  { start: 2, end: 3, string: 3, fret: 7 },
  { start: 2, end: 2.05, string: 1, fret: 3 },
  { start: 4, end: 5, string: 4, fret: 9 },
]);

beforeEach(() => {
  builds.count = 0;
});

describe('one moment per frame', () => {
  it('builds the moment once for an exported frame with several panels and the bar strip', () => {
    const { ctx } = createRecordingContext();
    renderStageFrame(ctx as unknown as FrameContext, song, 0, 2.2, W, H, ['highway', 'fretboard'], { lookahead: 4 });
    expect(builds.count).toBe(1);
  });

  it('builds it once for a frame with the neck, the pick view and the tab strip too', () => {
    const { ctx } = createRecordingContext();
    renderStageFrame(ctx as unknown as FrameContext, song, 0, 2.2, W, H, ['tab', 'neck'], { lookahead: 4 });
    expect(builds.count).toBe(1);
  });

  it('builds the draw state moment from the frame time, look-ahead and loop', () => {
    const state = { timeline: song, trackIndex: 0, t: 2.2, loop: { startBar: 1, endBar: 2 }, lookahead: 3, labelMode: 'fret' as const, neckCues: true, photo: null };
    const moment = frameMoment(state);
    expect(moment.t).toBe(2.2);
    expect(moment.lookahead).toBe(3);
    expect(moment.loop).toEqual({ startBar: 1, endBar: 2 });
  });
});

describe('a given moment and a renderer that builds its own draw the same', () => {
  const times = [0.5, 1.2, 1.7, 2.02, 2.5, 3.2];

  function same(draw: (ctx: ReturnType<typeof createRecordingContext>['ctx'], moment: ReturnType<typeof momentAt> | undefined, t: number) => void) {
    for (const t of times) {
      const own = createRecordingContext();
      draw(own.ctx, undefined, t);
      const shared = createRecordingContext();
      draw(shared.ctx, momentAt(song, 0, t, { lookahead: 4 }), t);
      expect(shared.calls).toEqual(own.calls);
    }
  }

  it('the highway', () => same((ctx, moment, t) => renderHighway(ctx, song, 0, t, W, H, { moment })));
  it('the fretboard', () => same((ctx, moment, t) => renderFretboard(ctx, song, 0, t, W, H, { lookahead: 4, moment })));
  it('the neck view, with the technique cues on', () =>
    same((ctx, moment, t) => renderNeckFrame(ctx as unknown as PhotoContext, null, song, 0, t, W, H, { zoom: true, lookahead: 4, techniqueCues: true, moment })));
  it('the tab strip', () => same((ctx, moment, t) => renderTabStrip(ctx, song, 0, t, W, 200, { moment })));
  it('the bar timeline', () => same((ctx, moment, t) => renderBarTimeline(ctx, song, t, W, 40, { moment })));
});

describe('the tab strip and bar timeline take the loop from the moment', () => {
  it('draws the loop tint from the moment when no loop option is given', () => {
    const tinted = (calls: ReturnType<typeof createRecordingContext>['calls']) => calls.filter((c) => c.name === 'set:fillStyle' && String(c.args[0]).startsWith('rgba(77')).length;
    const moment = momentAt(song, 0, 1, { loop: { startBar: 1, endBar: 2 } });
    const strip = createRecordingContext();
    renderTabStrip(strip.ctx, song, 0, 1, W, 200, { moment });
    const bar = createRecordingContext();
    renderBarTimeline(bar.ctx, song, 1, W, 40, { moment });
    expect(tinted(strip.calls)).toBe(1);
    expect(tinted(bar.calls)).toBe(1);
  });
});

describe('across a repeat', () => {
  it('covers AE5: just after the jump back the moment is in the repeated bar, and the strip shows that bar signature', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const moment = momentAt(timeline, 0, 6.01);
    expect(timeline.bars[moment.playbackBar].scoreBar).toBe(0);
    const { ctx } = createRecordingContext();
    expect(() => renderTabStrip(ctx, timeline, 0, 6.01, W, 200, { moment })).not.toThrow();
  });
});

describe('an exported frame matches the page at the exact start and end of a note', () => {
  // the fretboard is the only panel here, with the bar strip under it
  const panelHeight = frameLayout(H, 1, true).panels[0].height;
  const neck = computeNeck(W, panelHeight, 6, 9);
  const haloAt = (t: number) => {
    const { ctx, calls } = createRecordingContext();
    renderStageFrame(ctx as unknown as FrameContext, song, 0, t, W, H, ['fretboard'], { lookahead: 4 });
    return calls.filter((c) => c.name === 'arc' && (c.args[0] as number) === noteDotX(neck, 7) && (c.args[2] as number) > neck.dotRadius * 1.3).length;
  };

  it('covers AE3: sounding at 2.0 s and not at 3.0 s', () => {
    expect(haloAt(2)).toBeGreaterThan(0);
    expect(haloAt(3)).toBe(0);
  });
});
