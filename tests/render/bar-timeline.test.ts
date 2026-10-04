import { describe, expect, it } from 'vitest';
import {
  barAtX,
  buildBarTimeline,
  labelEvery,
  MIN_LABEL_WIDTH,
  renderBarTimeline,
  timelinePlayheadX,
} from '../../src/render/bar-timeline';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { makeTimeline } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';

const W = 800;
const H = 24;

describe('bar timeline layout', () => {
  it('fills the width with bars proportional to their length', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildBarTimeline(timeline, W, H);
    expect(layout.bars.map((b) => b.scoreBar)).toEqual([0, 1, 2, 3]);
    const end = layout.bars[layout.bars.length - 1];
    expect(end.x + end.width).toBeCloseTo(W, 6);
    // the fourth bar is at 60 bpm, so it lasts twice as long as the first
    expect(layout.bars[3].width).toBeCloseTo(layout.bars[0].width * 2, 6);
  });

  it('maps an x position to the bar under it, including the first and last pixels', () => {
    const layout = buildBarTimeline(buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO)), W, H);
    expect(barAtX(layout, 0)).toBe(0);
    expect(barAtX(layout, W - 0.5)).toBe(3);
    expect(barAtX(layout, layout.bars[1].x + 1)).toBe(1);
  });

  it('returns no bar outside the bars', () => {
    const layout = buildBarTimeline(buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO)), W, H);
    expect(barAtX(layout, -5)).toBeNull();
    expect(barAtX(layout, W + 5)).toBeNull();
  });

});

describe('playhead', () => {
  const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
  const layout = buildBarTimeline(timeline, W, H);

  it('moves with playback time', () => {
    expect(timelinePlayheadX(layout, timeline, 1)).toBeLessThan(timelinePlayheadX(layout, timeline, 3));
  });

  it('jumps back across a repeat while time keeps increasing', () => {
    const before = timelinePlayheadX(layout, timeline, 5.99);
    const after = timelinePlayheadX(layout, timeline, 6.01);
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(layout.bars[0].x + (0.01 / 2) * layout.bars[0].width, 3);
  });
});

describe('bar numbers', () => {
  it('draws every number when bars are wide enough', () => {
    const layout = buildBarTimeline(buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO)), W, H);
    expect(labelEvery(layout)).toBe(1);
  });

  it('is not thrown off by one very short bar', () => {
    const timeline = makeTimeline([], 2, 8);
    // a pickup bar a fraction of the length of the others
    const bars = timeline.bars.map((b, i) => (i === 0 ? { ...b, endSeconds: b.startSeconds + 0.05 } : b));
    const layout = buildBarTimeline({ ...timeline, bars }, 800, H);
    expect(layout.bars[0].width).toBeLessThan(MIN_LABEL_WIDTH);
    expect(labelEvery(layout)).toBe(1);
  });

  it('thins the numbers on a long score, while every bar stays clickable', () => {
    const timeline = makeTimeline([], 2, 120);
    const layout = buildBarTimeline(timeline, 600, H);
    expect(layout.bars[0].width).toBeLessThan(MIN_LABEL_WIDTH);
    const every = labelEvery(layout);
    expect(every).toBeGreaterThan(1);

    const { ctx, calls } = createRecordingContext();
    renderBarTimeline(ctx, timeline, 0, 600, H);
    const labels = calls.filter((c) => c.name === 'fillText');
    expect(labels.length).toBeLessThan(120);
    expect(labels.length).toBeGreaterThan(0);

    // a click in the middle of any bar maps to that bar
    for (const bar of layout.bars) expect(barAtX(layout, bar.x + bar.width / 2)).toBe(bar.scoreBar);
  });
});

describe('renderBarTimeline', () => {
  it('tints exactly the looped bars', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const { ctx, calls } = createRecordingContext();
    renderBarTimeline(ctx, timeline, 0, W, H, { loop: { startBar: 1, endBar: 2 } });
    const layout = buildBarTimeline(timeline, W, H);
    const tintAt = calls.findIndex((c) => c.name === 'set:fillStyle' && String(c.args[0]).startsWith('rgba'));
    expect(tintAt).toBeGreaterThanOrEqual(0);
    const rect = calls.slice(tintAt).find((c) => c.name === 'fillRect');
    expect(rect?.args[0]).toBeCloseTo(layout.bars[1].x, 6);
    expect(rect?.args[2] as number).toBeCloseTo(layout.bars[1].width + layout.bars[2].width, 6);
  });

  it('draws no tint without a loop', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const { ctx, calls } = createRecordingContext();
    renderBarTimeline(ctx, timeline, 0, W, H);
    expect(calls.filter((c) => c.name === 'set:fillStyle' && String(c.args[0]).startsWith('rgba'))).toHaveLength(0);
  });

  it('draws the same calls twice for the same time', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const a = createRecordingContext();
    const b = createRecordingContext();
    renderBarTimeline(a.ctx, timeline, 4.2, W, H);
    renderBarTimeline(b.ctx, timeline, 4.2, W, H);
    expect(a.calls).toEqual(b.calls);
  });
});
