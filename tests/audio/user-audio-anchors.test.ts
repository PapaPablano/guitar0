import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { UserAudioClock, type AudioLike } from '../../src/audio/user-audio';
import { StemMixClock, type StemChannel } from '../../src/audio/stem-mix';
import { STEM_NAMES } from '../../src/stems/engine-client';

function fakeAudio(): AudioLike & { paused: boolean; ended: boolean; duration: number } {
  return {
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    paused: true,
    ended: false,
    duration: 120,
    async play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
  };
}

/** Six bars of 2 s; the band dragged in bar 1, rushed bar 3 and played 8 s of extra material after bar 5. */
const bars = Array.from({ length: 6 }, (_, i) => ({ start: i * 2, end: i * 2 + 2 }));
const anchors = [1.5, 3.6, 5.6, 7.3, 9.3, 19.3];
const drifting = () => AlignmentMap.fromAnchors(bars, anchors, 21.3)!;

describe('UserAudioClock with an anchor per bar', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    let now = 100;
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 12, null, null, () => now);
    clock.setAlignment(drifting());
    return { el, clock, advance: (s: number) => (now += s) };
  }

  it('covers AE1: a seek into a bar lands on that bar\'s anchor plus the time into the bar, not on a single offset', () => {
    const { el, clock } = setup();
    clock.seek(5);
    // bar 2 starts at 4 and its anchor is 5.6; a single offset of 1.5 would have said 6.5
    expect(el.currentTime).toBeCloseTo(6.6, 9);
    clock.seek(8);
    expect(el.currentTime).toBeCloseTo(9.3, 9);
    clock.seek(10);
    // the rejoin side of the extra playing
    expect(el.currentTime).toBeCloseTo(19.3, 9);
  });

  it('covers AE2: inside a bar tab time follows the element steadily, and steps at the next anchor, with no seek', () => {
    const { el, clock } = setup();
    clock.seek(4);
    clock.play();
    el.currentTime = 7;
    expect(clock.time()).toBeCloseTo(5.4, 9);
    el.currentTime = 7.29;
    expect(clock.time()).toBeCloseTo(5.69, 9);
    // bar 3 was recorded short, so tab time steps forward at its anchor
    el.currentTime = 7.3;
    expect(clock.time()).toBeCloseTo(6, 9);
    expect(el.currentTime).toBe(7.3);
    clock.dispose();
  });

  it('covers AE6: a section loop restarts on the same anchor on twenty passes, at full speed and at 0.6', () => {
    for (const rate of [1, 0.6]) {
      const { el, clock } = setup();
      clock.setRate(rate);
      let wraps = 0;
      clock.setLoopWrapListener(() => (wraps += 1));
      // the loop covers bars 2 and 3: from tab 4 to tab 8, whose arrival is the end of bar 3's run, 9.3
      clock.setLoop({ start: 4, end: 8 });
      clock.seek(4);
      clock.play();
      for (let pass = 0; pass < 20; pass++) {
        el.currentTime = 9.3;
        expect(clock.time()).toBeCloseTo(4, 9);
        expect(el.currentTime).toBeCloseTo(5.6, 9);
      }
      expect(wraps).toBe(20);
      clock.dispose();
    }
  });

  it('pausing in a wait goes on from there; pausing inside a steady bar puts the element on the same moment', () => {
    const { el, clock } = setup();
    clock.seek(8);
    clock.play();
    el.currentTime = 15; // waiting on the line after bar 4
    clock.pause();
    clock.play();
    expect(el.currentTime).toBe(15);

    el.currentTime = 6.4;
    clock.pause();
    clock.play();
    expect(el.currentTime).toBeCloseTo(6.4, 9);
    clock.dispose();
  });

  it('keeps tab time moving with the element through the wait and out of it', () => {
    const { el, clock } = setup();
    clock.seek(8);
    clock.play();
    el.currentTime = 11.3;
    expect(clock.time()).toBeCloseTo(10 - 0.001, 9);
    el.currentTime = 19.3;
    expect(clock.time()).toBeCloseTo(10, 9);
    clock.dispose();
  });
});

describe('UserAudioClock landing report', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const STEP = 0.02;

  function setup() {
    vi.useFakeTimers();
    let now = 100;
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 12, null, null, () => now);
    clock.setAlignment(drifting());
    const reports: { tab: number; error: number }[] = [];
    clock.setLandingListener((r) => reports.push(r));
    const run = async (seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        now += STEP;
        if (!el.paused) el.currentTime += STEP * clock.rate;
        await vi.advanceTimersByTimeAsync(20);
      }
    };
    return { el, clock, reports, run };
  }

  it('reports how far a jump landed from the bar\'s anchor before correcting it', async () => {
    const { el, clock, reports, run } = setup();
    clock.seek(0);
    clock.play();
    clock.seek(5); // jumps while playing; the element is put at 6.6
    el.currentTime = 6.6 + 0.06; // the seek landed late
    await run(0.1);
    expect(reports).toHaveLength(1);
    expect(reports[0].tab).toBeCloseTo(5, 9);
    expect(reports[0].error).toBeCloseTo(0.06, 6);
    // and it was corrected
    expect(Math.abs(el.currentTime - (6.6 + 0.1))).toBeLessThan(0.025);
    clock.dispose();
  });

  it('reports a small error for a good landing and leaves the element alone', async () => {
    const { el, clock, reports, run } = setup();
    clock.seek(0);
    clock.play();
    clock.seek(8);
    el.currentTime = 9.3 + 0.004;
    await run(0.1);
    expect(reports).toHaveLength(1);
    expect(reports[0].error).toBeCloseTo(0.004, 6);
    clock.dispose();
  });

  it('reports each landing once, not once per correction', async () => {
    const { el, clock, reports, run } = setup();
    clock.seek(0);
    clock.play();
    clock.seek(5);
    el.currentTime = 6.6 + 0.2;
    await run(0.3);
    expect(reports).toHaveLength(1);
    clock.dispose();
  });

  it('stops reporting when the listener is cleared', async () => {
    const { el, clock, reports, run } = setup();
    clock.setLandingListener(null);
    clock.seek(0);
    clock.play();
    clock.seek(5);
    el.currentTime = 6.6 + 0.06;
    await run(0.1);
    expect(reports).toHaveLength(0);
    clock.dispose();
  });
});

describe('StemMixClock with an anchor per bar', () => {
  function channels() {
    const list: StemChannel[] = STEM_NAMES.map((name) => ({
      name,
      element: fakeAudio(),
      setGain: () => {},
      dispose: vi.fn(),
    }));
    return list;
  }

  it('lands every stem together on a bar\'s anchor and passes the landing report on from the leader', async () => {
    vi.useFakeTimers();
    let now = 100;
    const list = channels();
    const clock = new StemMixClock(list, 12, () => now);
    clock.setAlignment(drifting());
    const reports: { tab: number; error: number }[] = [];
    clock.setLandingListener((r) => reports.push(r));
    clock.seek(0);
    clock.play();
    clock.seek(5);
    for (const c of list) expect((c.element as ReturnType<typeof fakeAudio>).currentTime).toBeCloseTo(6.6, 9);
    (list[0].element as ReturnType<typeof fakeAudio>).currentTime = 6.6 + 0.06;
    for (let i = 0; i < 6; i++) {
      now += 0.02;
      (list[0].element as ReturnType<typeof fakeAudio>).currentTime += 0.02;
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(reports).toHaveLength(1);
    expect(reports[0].error).toBeCloseTo(0.06, 6);
    clock.dispose();
    vi.useRealTimers();
  });
});
