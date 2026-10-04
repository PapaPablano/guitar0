import { describe, expect, it } from 'vitest';
import {
  buildStripLayout,
  playheadStripX,
  renderTabStrip,
  scoreBarAtX,
  scoreBarStartSeconds,
  stripScrollX,
} from '../../src/render/tab-strip';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { makeTimeline } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';

const W = 900;
const H = 200;

describe('tab strip layout', () => {
  it('lays bars out in score order and marks repeat boundaries', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    expect(layout.bars.map((b) => b.scoreBar)).toEqual([0, 1, 2, 3]);
    expect(layout.bars.map((b) => b.repeatStart)).toEqual([true, false, false, false]);
    expect(layout.bars.map((b) => b.repeatEnd)).toEqual([false, false, true, false]);
    // each bar's notes are listed once even though the repeat plays them twice
    expect(layout.bars.reduce((sum, b) => sum + b.notes.length, 0)).toBe(16);
  });

  it('keeps the cursor on the same bar position the highway shows, and jumps back across a repeat', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    // bars are 2 s long at 120 bpm; the repeat sends playback from the end of bar 2 (6 s) back to bar 0
    const beforeJump = playheadStripX(layout, timeline, 5.99);
    const afterJump = playheadStripX(layout, timeline, 6.01);
    expect(afterJump).toBeLessThan(beforeJump);
    expect(afterJump).toBeCloseTo(layout.bars[0].x + (0.01 / 2) * layout.bars[0].width, 3);
    // playback time keeps increasing while the strip x moved back
    expect(6.01).toBeGreaterThan(5.99);
  });

  it('scrolls so the playhead sits at the fixed cursor position', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    const t = 3;
    expect(playheadStripX(layout, timeline, t) - stripScrollX(layout, timeline, t)).toBeCloseTo(layout.cursorX, 9);
  });

  it('finds the bar under a canvas position and the start time of a bar', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    expect(scoreBarAtX(layout, timeline, 0, layout.cursorX + 1)).toBe(0);
    expect(scoreBarAtX(layout, timeline, 0, W + 5000)).toBeNull();
    expect(scoreBarStartSeconds(layout, 1)).toBeCloseTo(2, 6);
    expect(scoreBarStartSeconds(layout, 9)).toBeNull();
  });
});

describe('renderTabStrip', () => {
  it('draws one fret number per note in view and the cursor', () => {
    const timeline = makeTimeline([
      { start: 0.5, end: 1, string: 2, fret: 5 },
      { start: 1, end: 1.5, string: 3, fret: 7 },
    ]);
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, H);
    const labels = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(labels).toContain('5');
    expect(labels).toContain('7');
  });

  it('renders the same calls twice for the same time', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const a = createRecordingContext();
    const b = createRecordingContext();
    renderTabStrip(a.ctx, timeline, 0, 4.2, W, H);
    renderTabStrip(b.ctx, timeline, 0, 4.2, W, H);
    expect(a.calls).toEqual(b.calls);
  });

  it('highlights the loop range', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, H, { loop: { startBar: 1, endBar: 2 } });
    const tinted = calls.filter((c) => c.name === 'set:fillStyle' && String(c.args[0]).startsWith('rgba'));
    expect(tinted).toHaveLength(1);
  });
});
