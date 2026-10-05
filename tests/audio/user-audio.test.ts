import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadUserAudio, MAX_AUDIO_BYTES, UserAudioClock, type AudioLike } from '../../src/audio/user-audio';

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

describe('UserAudioClock', () => {
  it('keeps pitch while the tempo changes', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    clock.setRate(0.5);
    expect(el.playbackRate).toBe(0.5);
    expect(el.preservesPitch).toBe(true);
  });

  it('shifts the tab against the recording by the offset', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    clock.setOffset(1.5);
    clock.seek(10);
    // the recording sits 1.5 s further in than the tab
    expect(el.currentTime).toBeCloseTo(11.5, 9);
    expect(clock.time()).toBeCloseTo(10, 9);
    clock.setOffset(0.5);
    // the recording stays put, so the tab time moves
    expect(clock.time()).toBeCloseTo(11, 9);
  });

  it('accepts a negative offset and clamps at the shared range limits', () => {
    const clock = new UserAudioClock(fakeAudio(), 60);
    clock.setOffset(-2);
    expect(clock.offset).toBe(-2);
    clock.setOffset(-99);
    expect(clock.offset).toBe(-30);
    clock.setOffset(99);
    expect(clock.offset).toBe(30);
  });

  it('never reports a negative tab time when the recording has a lead-in', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    clock.setOffset(3);
    el.currentTime = 1;
    expect(clock.time()).toBe(0);
  });

  it('wraps to the loop start while playing', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    clock.setOffset(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.play();
    el.currentTime = 9.2; // tab time 8.2, past the loop end
    expect(clock.time()).toBe(4);
    expect(el.currentTime).toBeCloseTo(5, 9);
  });

  it('does not wrap when paused', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    clock.setLoop({ start: 4, end: 8 });
    el.currentTime = 9;
    expect(clock.time()).toBe(9);
  });

  it('clamps seeks to the length of the tab', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    clock.seek(500);
    expect(clock.time()).toBe(60);
    clock.seek(-5);
    expect(clock.time()).toBe(0);
  });
});

describe('UserAudioClock timer checks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wraps the loop on a timer even when nothing is reading the clock', async () => {
    vi.useFakeTimers();
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(7.9);
    clock.play();
    el.currentTime = 8.3; // the recording ran past the loop end while frames were throttled
    await vi.advanceTimersByTimeAsync(40);
    expect(el.currentTime).toBeCloseTo(4, 9);
    clock.dispose();
  });

  it('pauses at the end of the tab when the recording is longer', async () => {
    vi.useFakeTimers();
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 10);
    clock.seek(9.9);
    clock.play();
    el.currentTime = 10.4;
    await vi.advanceTimersByTimeAsync(40);
    expect(el.paused).toBe(true);
    expect(clock.time()).toBe(10);
    clock.dispose();
  });

  it('stops its timer when paused or disposed', async () => {
    vi.useFakeTimers();
    const clock = new UserAudioClock(fakeAudio(), 60);
    clock.play();
    expect(vi.getTimerCount()).toBe(1);
    clock.pause();
    expect(vi.getTimerCount()).toBe(0);
    clock.play();
    clock.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('UserAudioClock lead-in', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(offset = -1.5, duration = 60) {
    let now = 100;
    const el = fakeAudio();
    const clock = new UserAudioClock(el, duration, null, null, () => now);
    clock.setOffset(offset);
    return {
      el,
      clock,
      advance(seconds: number) {
        now += seconds;
      },
    };
  }

  it('covers AE7: tab time runs on the time source while the element waits, then the element starts', () => {
    const { el, clock, advance } = setup(-1.5);
    clock.seek(0);
    clock.play();
    expect(clock.playing).toBe(true);
    expect(el.paused).toBe(true);
    advance(1);
    expect(clock.time()).toBeCloseTo(1, 9);
    expect(el.paused).toBe(true);
    expect(el.currentTime).toBe(0);
    advance(0.5);
    expect(clock.time()).toBeCloseTo(1.5, 9);
    expect(el.paused).toBe(false);
    expect(el.currentTime).toBeCloseTo(0, 9);
  });

  it('starts the element at the overshoot when the timer fires late, with no jump in tab time', () => {
    const { el, clock, advance } = setup(-1.5);
    clock.seek(0);
    clock.play();
    advance(1.515);
    const tab = clock.time();
    expect(tab).toBeCloseTo(1.515, 9);
    expect(el.currentTime).toBeCloseTo(0.015, 9);
    expect(el.paused).toBe(false);
    // the element now owns time and agrees with the virtual time it replaced
    expect(clock.time()).toBeCloseTo(tab, 9);
  });

  it('advances tab time at the playback rate and lasts twice as long at rate 0.5', () => {
    const { el, clock, advance } = setup(-1.5);
    clock.setRate(0.5);
    clock.seek(0);
    clock.play();
    advance(2);
    expect(clock.time()).toBeCloseTo(1, 9);
    expect(el.paused).toBe(true);
    advance(1);
    expect(clock.time()).toBeCloseTo(1.5, 9);
    expect(el.paused).toBe(false);
  });

  it('keeps tab time continuous when the rate changes mid lead-in', () => {
    const { clock, advance } = setup(-2);
    clock.seek(0);
    clock.play();
    advance(1);
    clock.setRate(0.5);
    expect(clock.time()).toBeCloseTo(1, 9);
    advance(1);
    expect(clock.time()).toBeCloseTo(1.5, 9);
  });

  it('freezes tab time while paused in the lead-in and continues on resume without starting the element', () => {
    const { el, clock, advance } = setup(-1.5);
    clock.seek(0);
    clock.play();
    advance(0.5);
    clock.pause();
    expect(clock.playing).toBe(false);
    advance(10);
    expect(clock.time()).toBeCloseTo(0.5, 9);
    clock.play();
    expect(el.paused).toBe(true);
    advance(0.25);
    expect(clock.time()).toBeCloseTo(0.75, 9);
    expect(el.paused).toBe(true);
  });

  it('seeks into the lead-in, or starts the element partway in', () => {
    const { el, clock, advance } = setup(-1.5);
    clock.seek(0.5);
    expect(el.currentTime).toBe(0);
    expect(clock.time()).toBeCloseTo(0.5, 9);
    clock.play();
    advance(0.25);
    expect(clock.time()).toBeCloseTo(0.75, 9);
    clock.seek(2);
    expect(el.currentTime).toBeCloseTo(0.5, 9);
    expect(el.paused).toBe(false);
    expect(clock.time()).toBeCloseTo(2, 9);
  });

  it('seeking from the audio back into the silence pauses the element and re-enters the lead-in', () => {
    const { el, clock, advance } = setup(-1.5);
    clock.seek(3);
    clock.play();
    expect(el.paused).toBe(false);
    clock.seek(0.5);
    expect(el.paused).toBe(true);
    expect(el.currentTime).toBe(0);
    expect(clock.playing).toBe(true);
    advance(0.5);
    expect(clock.time()).toBeCloseTo(1, 9);
  });

  it('re-enters the lead-in on every loop wrap and never sets a negative element position', () => {
    const { el, clock, advance } = setup(-1.5);
    const positions: number[] = [];
    let position = 0;
    Object.defineProperty(el, 'currentTime', {
      get: () => position,
      set: (v: number) => {
        positions.push(v);
        position = v;
      },
    });
    clock.setLoop({ start: 0, end: 4 });
    clock.seek(0);
    clock.play();
    advance(1.5);
    expect(clock.time()).toBeCloseTo(1.5, 9);
    position = 2.5; // the recording plays on to the loop end (tab 4)
    advance(2.5);
    expect(clock.time()).toBe(0);
    expect(el.paused).toBe(true);
    expect(clock.playing).toBe(true);
    advance(1);
    expect(clock.time()).toBeCloseTo(1, 9);
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it('behaves as before for a positive offset: skips in, wraps and seeks near the start', () => {
    const { el, clock } = setup(2);
    clock.seek(0);
    expect(el.currentTime).toBeCloseTo(2, 9);
    clock.setLoop({ start: 1, end: 3 });
    clock.play();
    el.currentTime = 5.1;
    expect(clock.time()).toBe(1);
    expect(el.currentTime).toBeCloseTo(3, 9);
    clock.seek(0.1);
    expect(el.currentTime).toBeCloseTo(2.1, 9);
  });

  it('keeps the recording where it is when the offset changes during the lead-in', () => {
    const { el, clock, advance } = setup(-2);
    clock.seek(0);
    clock.play();
    advance(1);
    clock.setOffset(-3);
    // the recording was 1 s short of its start; it still is, so the tab sits 2 s before it starts
    expect(clock.time()).toBeCloseTo(2, 9);
    expect(el.paused).toBe(true);
    advance(1);
    clock.time();
    expect(el.paused).toBe(false);
  });

  it('keeps the playhead when a negative offset is applied to a paused clock whose recording has not started', () => {
    const { el, clock, advance } = setup(0);
    clock.setOffset(-1.5);
    expect(clock.time()).toBe(0);
    clock.play();
    expect(clock.inLeadIn).toBe(true);
    advance(1.5);
    expect(clock.time()).toBeCloseTo(1.5, 9);
    expect(el.paused).toBe(false);
  });

  it('keeps the playhead while the offset is dragged further negative before playing', () => {
    const { clock } = setup(-1);
    clock.seek(0);
    clock.setOffset(-2);
    expect(clock.time()).toBe(0);
    clock.setOffset(-3);
    expect(clock.time()).toBe(0);
  });

  it('keeps tracking the element when the offset changes at the instant the lead-in has handed over', () => {
    const { el, clock, advance } = setup(-1.5);
    clock.seek(0);
    clock.play();
    // The time source runs past the end of the lead-in before anything reads the clock.
    advance(2);
    clock.setOffset(-1);
    expect(clock.inLeadIn).toBe(false);
    expect(el.paused).toBe(false);
    // The element is running, so tab time follows it; it must not be frozen at a held value.
    el.currentTime = 3;
    expect(clock.time()).toBeCloseTo(4, 9);
  });

  it('a recording shorter than the tab stops and does not restart the lead-in', async () => {
    vi.useFakeTimers();
    const { el, clock, advance } = setup(-1, 60);
    clock.seek(0);
    clock.play();
    advance(1);
    clock.time();
    expect(el.paused).toBe(false);
    el.paused = true;
    el.ended = true;
    el.currentTime = 5;
    advance(20);
    await vi.advanceTimersByTimeAsync(40);
    expect(clock.playing).toBe(false);
    expect(el.currentTime).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops at the end of the tab when the lead-in outlasts it', () => {
    const { clock, advance } = setup(-30, 10);
    clock.seek(0);
    clock.play();
    advance(11);
    expect(clock.time()).toBe(10);
    expect(clock.playing).toBe(false);
  });

  it('keeps its timer running during the lead-in and releases it on dispose', async () => {
    vi.useFakeTimers();
    const { clock } = setup(-1.5);
    clock.seek(0);
    clock.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.getTimerCount()).toBe(1);
    clock.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('loadUserAudio', () => {
  it('rejects a recording over the size limit before reading it', async () => {
    const big = new File([new Uint8Array(8)], 'big.wav');
    Object.defineProperty(big, 'size', { value: MAX_AUDIO_BYTES + 1 });
    await expect(loadUserAudio(big, 10)).rejects.toThrow(/too large/);
  });
});

describe('UserAudioClock loop-wrap notification', () => {
  it('fires once per wrap on the element path', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    let wraps = 0;
    clock.setLoopWrapListener(() => wraps++);
    clock.setLoop({ start: 4, end: 8 });
    clock.play();
    el.currentTime = 8.2;
    clock.time();
    expect(wraps).toBe(1);
    clock.time();
    expect(wraps).toBe(1);
  });

  it('fires for a wrap that happens during the lead-in silence', () => {
    let now = 100;
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60, null, null, () => now);
    clock.setOffset(-5);
    let wraps = 0;
    clock.setLoopWrapListener(() => wraps++);
    clock.setLoop({ start: 0, end: 2 });
    clock.seek(0);
    clock.play();
    now += 2.5; // still before the recording starts (tab 5)
    clock.time();
    expect(wraps).toBe(1);
    expect(clock.inLeadIn).toBe(true);
  });

  it('does not fire without a loop', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    let wraps = 0;
    clock.setLoopWrapListener(() => wraps++);
    clock.play();
    el.currentTime = 9;
    clock.time();
    expect(wraps).toBe(0);
  });

  it('does not fire while paused, even past the loop end', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60);
    let wraps = 0;
    clock.setLoopWrapListener(() => wraps++);
    clock.setLoop({ start: 4, end: 8 });
    el.currentTime = 9;
    clock.time();
    expect(wraps).toBe(0);
  });
});

describe('UserAudioClock loop landing check', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const STEP = 0.02;

  /** A clock on a manual time source with a fake element that advances as time passes. */
  function setup(offset = 1) {
    vi.useFakeTimers();
    let now = 100;
    const el = fakeAudio();
    const clock = new UserAudioClock(el, 60, null, null, () => now);
    clock.setOffset(offset);
    const run = async (seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        now += STEP;
        if (!el.paused) el.currentTime += STEP * clock.rate;
        await vi.advanceTimersByTimeAsync(20);
      }
    };
    /** Steps until the loop wraps and returns where the element was put, before any later tick runs. */
    const untilWrap = async () => {
      let previous = el.currentTime;
      for (let i = 0; i < 400; i++) {
        now += STEP;
        if (!el.paused) el.currentTime += STEP * clock.rate;
        await vi.advanceTimersByTimeAsync(20);
        if (el.currentTime < previous - 0.5) return el.currentTime;
        previous = el.currentTime;
      }
      throw new Error('the loop never wrapped');
    };
    return { el, clock, run, untilWrap };
  }

  it('covers AE1: a restart that lands 60 ms late is corrected on the next check', async () => {
    const { el, clock, run, untilWrap } = setup(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(7.9);
    clock.play();
    const wrapped = await untilWrap(); // the loop start plus the offset, 5
    expect(wrapped).toBeCloseTo(5, 6);
    el.currentTime = wrapped + 0.06; // the seek landed late
    await run(0.1);
    // five ticks after the late landing: the correct position is the wrapped one plus 0.1
    expect(Math.abs(el.currentTime - (wrapped + 0.1))).toBeLessThan(0.025);
    clock.dispose();
  });

  it('leaves a landing inside the tolerance alone', async () => {
    const { el, clock, run, untilWrap } = setup(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(7.9);
    clock.play();
    const wrapped = await untilWrap();
    el.currentTime = wrapped + 0.01;
    await run(0.1);
    expect(el.currentTime).toBeCloseTo(wrapped + 0.01 + 0.1, 6);
    clock.dispose();
  });

  it('covers AE4: at 0.6 speed the expected position advances at 0.6', async () => {
    const { el, clock, run, untilWrap } = setup(1);
    clock.setRate(0.6);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(7.95);
    clock.play();
    const wrapped = await untilWrap();
    el.currentTime = wrapped + 0.08;
    await run(0.1);
    // five ticks of 20 ms at rate 0.6 is 0.06 of recording time
    expect(Math.abs(el.currentTime - (wrapped + 0.06))).toBeLessThan(0.025);
    clock.dispose();
  });

  it('waits while the element reports it is still seeking', async () => {
    const { el, clock, run, untilWrap } = setup(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(7.9);
    clock.play();
    const wrapped = await untilWrap();
    (el as { seeking?: boolean }).seeking = true;
    el.currentTime = wrapped + 0.2;
    await run(0.1);
    expect(el.currentTime).toBeCloseTo(wrapped + 0.2 + 0.1, 6);
    clock.dispose();
  });

  it('covers AE2: an offset change during a loop keeps the loop on the same bars', async () => {
    const { el, clock, run } = setup(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(5);
    clock.play();
    await run(0.1);
    clock.setOffset(2);
    expect(clock.loop).toEqual({ start: 4, end: 8 });
    el.currentTime = 9.9; // tab time 7.9 under the new offset
    await run(0.2);
    expect(el.currentTime).toBeLessThan(6.5); // wrapped to 4 + 2
    expect(el.currentTime).toBeGreaterThan(5.9);
    clock.dispose();
  });

  it('covers AE3: turning the loop off mid-pass keeps playing with no seek', async () => {
    const { el, clock, run } = setup(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(5);
    clock.play();
    await run(0.1);
    const before = el.currentTime;
    const tabBefore = clock.time();
    clock.setLoop(null);
    await run(0.1);
    expect(el.paused).toBe(false);
    expect(el.currentTime).toBeCloseTo(before + 0.1, 6);
    expect(clock.time()).toBeCloseTo(tabBefore + 0.1, 6);
    clock.dispose();
  });

  it('does not check during the silence before a recording that starts later', async () => {
    const { el, clock, run } = setup(-2);
    clock.setLoop({ start: 0, end: 3 });
    clock.play();
    await run(0.5);
    expect(clock.inLeadIn).toBe(true);
    expect(el.currentTime).toBe(0);
    clock.dispose();
  });

  it('still checks an element that never reports seeking', async () => {
    const { el, clock, run, untilWrap } = setup(0);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(7.9);
    clock.play();
    const wrapped = await untilWrap();
    expect('seeking' in el).toBe(false);
    el.currentTime = wrapped - 0.07;
    await run(0.1);
    expect(Math.abs(el.currentTime - (wrapped + 0.1))).toBeLessThan(0.025);
    clock.dispose();
  });
});

describe('UserAudioClock element swap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const STEP = 0.02;

  function setup(offset = 1) {
    vi.useFakeTimers();
    let now = 100;
    const original = fakeAudio();
    const copy = fakeAudio();
    const clock = new UserAudioClock(original, 60, null, null, () => now);
    clock.setOffset(offset);
    const run = async (seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        now += STEP;
        for (const el of [original, copy]) if (!el.paused) el.currentTime += STEP * clock.rate;
        await vi.advanceTimersByTimeAsync(20);
      }
    };
    return { original, copy, clock, run };
  }

  it('covers AE5: a copy offered while playing waits, then takes over at the next loop wrap', async () => {
    const { original, copy, clock, run } = setup(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(5);
    clock.play();
    clock.offerElement(copy);
    await run(0.5);
    expect(clock.element).toBe(original);
    expect(copy.paused).toBe(true);
    // play on to just past the loop end (started at tab 5, so tab 8 is 3 s in)
    await run(2.6);
    expect(clock.element).toBe(copy);
    expect(copy.paused).toBe(false);
    expect(original.paused).toBe(true);
    expect(copy.currentTime).toBeGreaterThanOrEqual(5);
    expect(copy.currentTime).toBeLessThan(5.3); // the loop start plus the offset, then a little playing
    clock.dispose();
  });

  it('covers AE5: tab time moves on by normal playback across the swap', async () => {
    const { copy, clock, run } = setup(1);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(7.8);
    clock.play();
    clock.offerElement(copy);
    const before = clock.time();
    await run(0.1);
    expect(clock.time()).toBeCloseTo(before + 0.1, 1);
    clock.dispose();
  });

  it('applies a copy offered while paused at once, at the same position', () => {
    const { original, copy, clock } = setup(1);
    clock.seek(10);
    clock.offerElement(copy);
    expect(clock.element).toBe(copy);
    expect(copy.currentTime).toBeCloseTo(original.currentTime, 9);
    expect(clock.time()).toBeCloseTo(10, 9);
    clock.play();
    expect(copy.paused).toBe(false);
    expect(original.paused).toBe(true);
    clock.dispose();
  });

  it('applies a pending copy when the clock is paused, carrying the position over', async () => {
    const { original, copy, clock, run } = setup(1);
    clock.seek(10);
    clock.play();
    clock.offerElement(copy);
    await run(0.2);
    const at = original.currentTime;
    clock.pause();
    expect(clock.element).toBe(copy);
    expect(copy.currentTime).toBeCloseTo(at, 9);
    expect(copy.paused).toBe(true);
    clock.dispose();
  });

  it('applies a pending copy on a seek while playing', async () => {
    const { original, copy, clock, run } = setup(1);
    clock.seek(10);
    clock.play();
    clock.offerElement(copy);
    await run(0.1);
    clock.seek(20);
    expect(clock.element).toBe(copy);
    expect(copy.currentTime).toBeCloseTo(21, 9);
    expect(copy.paused).toBe(false);
    expect(original.paused).toBe(true);
    clock.dispose();
  });

  it('a second copy offered before the first applies replaces it', async () => {
    const { copy, clock, run } = setup(1);
    const second = fakeAudio();
    clock.seek(10);
    clock.play();
    clock.offerElement(copy);
    clock.offerElement(second);
    await run(0.1);
    clock.seek(12);
    expect(clock.element).toBe(second);
    expect(copy.paused).toBe(true);
    clock.dispose();
  });

  it('carries the rate to the new element and keeps the loop', async () => {
    const { copy, clock, run } = setup(1);
    clock.setRate(0.5);
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(5);
    clock.play();
    clock.offerElement(copy);
    await run(0.1);
    clock.seek(6);
    expect(copy.playbackRate).toBe(0.5);
    expect(copy.preservesPitch).toBe(true);
    expect(clock.loop).toEqual({ start: 4, end: 8 });
    clock.dispose();
  });

  it('dispose pauses the element in use', () => {
    const { copy, clock } = setup(1);
    clock.seek(5);
    clock.offerElement(copy);
    clock.play();
    clock.dispose();
    expect(copy.paused).toBe(true);
  });
});
