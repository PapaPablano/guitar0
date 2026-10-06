import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { StemMixClock, type StemChannel } from '../../src/audio/stem-mix';
import { UserAudioClock, type AudioLike } from '../../src/audio/user-audio';
import { exportLength, outputWindow, tabTimeAt } from '../../src/export/audio';
import { STEM_NAMES } from '../../src/stems/engine-client';

function fakeAudio(): AudioLike & { paused: boolean; ended: boolean; duration: number } {
  return {
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    paused: true,
    ended: false,
    duration: 200,
    async play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
  };
}

/**
 * Ten bars: four of 2 s, three of 1.6 s (a tempo step), two of 2 s and one of 2.1 s. The band plays bar 2 for 8 s (6 s of
 * extra playing), skips bar 5 (it shares bar 6's anchor), and plays the rest a little slow or fast.
 */
const lengths = [2, 2, 2, 2, 1.6, 1.6, 1.6, 2, 2, 2.1];
const bars = lengths.map((length, k) => {
  const start = lengths.slice(0, k).reduce((a, b) => a + b, 0);
  return { start, end: start + length };
});
const recorded = [2, 2, 8, 2.04, 1.58, 0, 1.62, 2, 1.98, 2.1];
const anchors = recorded.map((_, k) => 1.2 + recorded.slice(0, k).reduce((a, b) => a + b, 0));
const endAnchor = 1.2 + recorded.reduce((a, b) => a + b, 0);
const timeline = () => AlignmentMap.fromAnchors(bars, anchors, endAnchor)!;
const TAB_END = bars[bars.length - 1].end;

describe('one timeline, three readers', () => {
  afterEach(() => vi.useRealTimers());

  /** The tab time a continuous play-through reads when the recording is at `position`. */
  function playThrough(map: AlignmentMap, position: number): number {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, TAB_END, null, null, () => 100);
    clock.setAlignment(map);
    clock.seek(0);
    clock.play();
    el.currentTime = position;
    const time = clock.time();
    clock.dispose();
    return time;
  }

  /** Where a jump to tab time `tab` puts the recording. */
  function jump(map: AlignmentMap, tab: number): number {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, TAB_END, null, null, () => 100);
    clock.setAlignment(map);
    clock.seek(tab);
    const position = el.currentTime;
    clock.dispose();
    return position;
  }

  it('covers AE1: every 0.5 s of recording time gives the same tab time in the play-through and the export frame calculation, to 1 ms', () => {
    const map = timeline();
    expect(map.holds.length).toBeGreaterThan(0); // the long bar
    for (let position = anchors[0]; position < endAnchor; position += 0.5) {
      const played = playThrough(map, position);
      const exported = tabTimeAt(map, position - map.base);
      expect(Math.abs(played - exported), `recording ${position.toFixed(2)} s`).toBeLessThanOrEqual(0.001);
    }
  });

  it('a jump to any tab time lands where the play-through and the export read that same tab time', () => {
    const map = timeline();
    for (let tab = 0; tab < TAB_END - 0.2; tab += 0.37) {
      const landed = jump(map, tab);
      // the position a jump chooses is on the timeline: read back through either reader it is the tab time asked for,
      // except inside a skipped bar, where the tab steps past it to the next bar line
      const played = playThrough(map, landed);
      const exported = tabTimeAt(map, landed - map.base);
      expect(Math.abs(played - exported)).toBeLessThanOrEqual(0.001);
      const skipped = bars[5];
      if (tab < skipped.start || tab >= skipped.end) expect(Math.abs(played - tab), `tab ${tab.toFixed(2)} s`).toBeLessThanOrEqual(0.011);
    }
  });

  it('the export is as long as the tab plus the extra playing, and a loop maps to the same recording span as a jump to its ends', () => {
    const map = timeline();
    expect(exportLength(TAB_END, map)).toBeCloseTo(map.outputLength(TAB_END), 9);
    const window = outputWindow(map, { startSeconds: bars[2].start, endSeconds: bars[4].start });
    expect(window.startSeconds + map.base).toBeCloseTo(jump(map, bars[2].start), 6);
    expect(window.endSeconds + map.base).toBeCloseTo(map.toRec(bars[4].start, 'end'), 6);
  });

  it('covers AE7: replacing the timeline under a set loop keeps its tab range and moves its recording times with the new timeline', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, TAB_END, null, null, () => 100);
    clock.setAlignment(timeline());
    clock.setLoop({ start: bars[3].start, end: bars[7].start });
    clock.seek(bars[3].start);
    const before = el.currentTime;
    const next = AlignmentMap.fromAnchors(bars, anchors.map((a) => a + 0.8), endAnchor + 0.8)!;
    clock.setAlignment(next);
    expect(clock.loop).toEqual({ start: bars[3].start, end: bars[7].start });
    clock.seek(bars[3].start);
    expect(el.currentTime).toBeCloseTo(before + 0.8, 9);
    clock.dispose();
  });

  it('a loop that spans a swap whose end is already behind the recording position wraps to its start once', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, TAB_END, null, null, () => 100);
    let wraps = 0;
    clock.setLoopWrapListener(() => (wraps += 1));
    clock.setAlignment(timeline());
    clock.setLoop({ start: bars[0].start, end: bars[2].start });
    clock.seek(bars[0].start);
    clock.play();
    el.currentTime = anchors[1] + 0.5; // inside the loop under the old timeline
    // the new timeline puts the loop's end earlier than the recording already is
    const earlier = AlignmentMap.fromAnchors(bars, anchors.map((a) => a - 1), endAnchor - 1)!;
    clock.setAlignment(earlier);
    el.currentTime = anchors[2] + 0.5;
    clock.time();
    expect(wraps).toBe(1);
    expect(el.currentTime).toBeCloseTo(earlier.toRec(bars[0].start, 'start'), 9);
    clock.dispose();
  });

  it('the stem clock and the plain recording clock return the same tab time from one timeline', () => {
    const map = timeline();
    const list: StemChannel[] = STEM_NAMES.map((name) => ({ name, element: fakeAudio(), setGain: () => {}, dispose: vi.fn() }));
    const stems = new StemMixClock(list, TAB_END, () => 100);
    stems.setAlignment(map);
    stems.seek(0);
    stems.play();
    for (let position = anchors[0]; position < endAnchor; position += 0.5) {
      for (const channel of list) (channel.element as ReturnType<typeof fakeAudio>).currentTime = position;
      expect(Math.abs(stems.time() - playThrough(map, position)), `recording ${position.toFixed(2)} s`).toBeLessThanOrEqual(0.001);
    }
    stems.dispose();
  });
});
