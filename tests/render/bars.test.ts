import { describe, expect, it } from 'vitest';
import { barSpans } from '../../src/render/bars';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { REPEAT_AND_TEMPO, STEADY } from '../fixtures/fixtures';

describe('barSpans', () => {
  it('lists score bars once and flags the repeat start and end', () => {
    const spans = barSpans(buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO)));
    expect(spans.map((b) => b.scoreBar)).toEqual([0, 1, 2, 3]);
    expect(spans.map((b) => b.repeatStart)).toEqual([true, false, false, false]);
    expect(spans.map((b) => b.repeatEnd)).toEqual([false, false, true, false]);
  });

  it('has no repeat flags for a score without repeats', () => {
    const spans = barSpans(buildTimeline(loadAlphaTex(STEADY)));
    expect(spans).toHaveLength(4);
    expect(spans.every((b) => !b.repeatStart && !b.repeatEnd)).toBe(true);
  });

  it('carries the first pass of each bar, with its times and ticks', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const spans = barSpans(timeline);
    // bar 1 first plays after bar 0: 2 s in at 120 bpm, 3840 ticks in
    expect(spans[1].playback.startSeconds).toBeCloseTo(2, 6);
    expect(spans[1].playback.startTick).toBe(3840);
    // the repeat plays bars 0-2 again, but spans point at the first pass
    expect(spans[0].playback.playbackIndex).toBe(0);
  });
});
