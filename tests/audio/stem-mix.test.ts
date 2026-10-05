import { afterEach, describe, expect, it, vi } from 'vitest';
import { StemMixClock, type StemChannel } from '../../src/audio/stem-mix';
import type { AudioLike } from '../../src/audio/user-audio';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { initialMix } from '../../src/audio/mix-gains';
import { STEM_NAMES, type StemName } from '../../src/stems/engine-client';

type FakeAudio = AudioLike & { paused: boolean; ended: boolean; duration: number };

function fakeAudio(): FakeAudio {
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

function channels() {
  const gains = {} as Record<StemName, number>;
  const list: StemChannel[] = STEM_NAMES.map((name) => {
    const element = fakeAudio();
    return {
      name,
      element,
      setGain: (g: number) => {
        gains[name] = g;
      },
      dispose: vi.fn(),
    };
  });
  return { list, gains, el: (name: StemName) => list.find((c) => c.name === name)!.element as FakeAudio };
}

describe('StemMixClock', () => {
  it('covers AE4: every stem gets the same rate with pitch preserved', () => {
    const { list } = channels();
    const clock = new StemMixClock(list, 60);
    clock.setRate(0.5);
    for (const c of list) {
      expect((c.element as FakeAudio).playbackRate).toBe(0.5);
      expect((c.element as FakeAudio).preservesPitch).toBe(true);
    }
  });

  it('seeks every stem to the same position, shifted by the offset', () => {
    const { list } = channels();
    const clock = new StemMixClock(list, 60);
    clock.setOffset(1.5);
    clock.seek(10);
    for (const c of list) expect((c.element as FakeAudio).currentTime).toBeCloseTo(11.5, 9);
    expect(clock.time()).toBeCloseTo(10, 9);
  });

  it('plays and pauses every stem together', async () => {
    const { list } = channels();
    const clock = new StemMixClock(list, 60);
    clock.play();
    await Promise.resolve();
    for (const c of list) expect((c.element as FakeAudio).paused).toBe(false);
    expect(clock.playing).toBe(true);
    clock.pause();
    for (const c of list) expect((c.element as FakeAudio).paused).toBe(true);
    clock.dispose();
  });

  it('pulls a follower that drifted 120 ms back to the leader and leaves one inside tolerance alone', () => {
    const { list, el } = channels();
    const clock = new StemMixClock(list, 60);
    const leader = list[0].element as FakeAudio;
    leader.currentTime = 20;
    el('drums').currentTime = 19.88;
    el('bass').currentTime = 20.01;
    clock.resync();
    expect(el('drums').currentTime).toBe(20);
    expect(el('bass').currentTime).toBe(20.01);
  });

  it('applies mix changes immediately through each stem gain stage', () => {
    const { list, gains } = channels();
    const clock = new StemMixClock(list, 60);
    const mix = initialMix();
    mix.guitar.muted = true;
    clock.setMix(mix);
    expect(gains.guitar).toBe(0);
    expect(gains.drums).toBe(1);
  });

  it('wraps a loop: every stem returns to the loop start', () => {
    const { list } = channels();
    const clock = new StemMixClock(list, 60);
    clock.setLoop({ start: 10, end: 12 });
    clock.seek(11.99);
    const leader = list[0].element as FakeAudio;
    leader.paused = false;
    leader.currentTime = 12.1;
    clock.time();
    clock.resync();
    for (const c of list) expect((c.element as FakeAudio).currentTime).toBeCloseTo(10, 6);
  });

  describe('with a negative offset (lead-in)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function setup() {
      let now = 50;
      const made = channels();
      const clock = new StemMixClock(made.list, 60, () => now);
      clock.setOffset(-1);
      clock.seek(0);
      return { ...made, clock, advance: (s: number) => (now += s) };
    }

    it('starts no follower before the leader and does not resync during the lead-in', async () => {
      vi.useFakeTimers();
      const { list, el, clock, advance } = setup();
      clock.play();
      for (const c of list) expect((c.element as FakeAudio).paused).toBe(true);
      expect(clock.playing).toBe(true);
      el('drums').currentTime = 3; // far from the leader, but the lead-in is not a time to correct it
      advance(0.5);
      await vi.advanceTimersByTimeAsync(40);
      expect(el('drums').currentTime).toBe(3);
      for (const c of list) expect((c.element as FakeAudio).paused).toBe(true);
      clock.dispose();
    });

    it('starts every follower at the leader position when the lead-in ends, then pulls drift back', async () => {
      vi.useFakeTimers();
      const { list, el, clock, advance } = setup();
      clock.play();
      advance(1.02);
      await vi.advanceTimersByTimeAsync(20);
      for (const c of list) expect((c.element as FakeAudio).paused).toBe(false);
      const leader = list[0].element as FakeAudio;
      expect(leader.currentTime).toBeCloseTo(0.02, 9);
      expect(el('drums').currentTime).toBeCloseTo(0.02, 9);
      leader.currentTime = 1;
      el('drums').currentTime = 0.88;
      await vi.advanceTimersByTimeAsync(20);
      expect(el('drums').currentTime).toBe(1);
      clock.dispose();
    });

    it('seeking into the lead-in leaves every stem at zero', () => {
      const { list, clock } = setup();
      clock.seek(0.5);
      for (const c of list) expect((c.element as FakeAudio).currentTime).toBe(0);
      expect(clock.time()).toBeCloseTo(0.5, 9);
    });
  });

  it('releases every channel on dispose', () => {
    const { list } = channels();
    new StemMixClock(list, 60).dispose();
    for (const c of list) expect(c.dispose).toHaveBeenCalled();
  });
});

describe('StemMixClock pass schedule', () => {
  function setup() {
    const ch = channels();
    let now = 100;
    const clock = new StemMixClock(ch.list, 60, () => now);
    const lead = ch.list[0].element as FakeAudio;
    const wrap = () => {
      lead.currentTime = 8.2;
      clock.time();
    };
    return { ch, clock, lead, wrap, advance: (s: number) => (now += s) };
  }
  const fade = { kind: 'fade-out', steps: [1, 0.6, 0.25, 0] } as const;

  it('applies 100, 60, 25, 0 to the guitar gain over successive wraps', () => {
    const { ch, clock, wrap } = setup();
    clock.setMix(initialMix());
    clock.setLoop({ start: 4, end: 8 });
    clock.setSchedule(fade);
    clock.play();
    const seen = [ch.gains.guitar];
    for (let i = 0; i < 4; i++) {
      wrap();
      seen.push(ch.gains.guitar);
    }
    expect(seen).toEqual([1, 0.6, 0.25, 0, 0]);
  });

  it('changing the loop range resets the pass count', () => {
    const { ch, clock, wrap } = setup();
    clock.setMix(initialMix());
    clock.setLoop({ start: 4, end: 8 });
    clock.setSchedule(fade);
    clock.play();
    wrap();
    wrap();
    expect(ch.gains.guitar).toBeCloseTo(0.25, 9);
    clock.setLoop({ start: 2, end: 8 });
    expect(clock.pass).toBe(1);
    expect(ch.gains.guitar).toBe(1);
  });

  it('counts a wrap during the lead-in as a pass', () => {
    const { ch, clock, advance } = setup();
    clock.setMix(initialMix());
    clock.setOffset(-5);
    clock.setLoop({ start: 0, end: 2 });
    clock.setSchedule(fade);
    clock.seek(0);
    clock.play();
    advance(2.5);
    clock.time();
    expect(clock.pass).toBe(2);
    expect(ch.gains.guitar).toBeCloseTo(0.6, 9);
  });

  it('restores the base mix when the schedule is turned off or the loop is cleared', () => {
    const { ch, clock, wrap } = setup();
    const base = initialMix();
    base.guitar.volume = 0.8;
    clock.setMix(base);
    clock.setLoop({ start: 4, end: 8 });
    clock.setSchedule(fade);
    clock.play();
    wrap();
    expect(ch.gains.guitar).toBeCloseTo(0.48, 9);
    clock.setSchedule({ kind: 'off' });
    expect(ch.gains.guitar).toBeCloseTo(0.8, 9);
    clock.setSchedule(fade);
    wrap();
    clock.setLoop(null);
    expect(ch.gains.guitar).toBeCloseTo(0.8, 9);
  });

  it('clearing the loop under a listen-then-play schedule restores every stem, not just the guitar', () => {
    const { ch, clock } = setup();
    clock.setMix(initialMix());
    clock.setLoop({ start: 4, end: 8 });
    clock.setSchedule({ kind: 'listen-then-play' });
    // Pass 1 is a guitar-only pass, so the drums are silent.
    expect(ch.gains.drums).toBe(0);
    clock.setLoop(null);
    expect(ch.gains.drums).toBe(1);
    expect(ch.gains.guitar).toBe(1);
  });

  it('a manual mix change while scheduled becomes the new base', () => {
    const { ch, clock } = setup();
    clock.setLoop({ start: 4, end: 8 });
    clock.setSchedule(fade);
    const base = initialMix();
    base.drums.volume = 0.5;
    clock.setMix(base);
    expect(ch.gains.drums).toBe(0.5);
    expect(ch.gains.guitar).toBe(1);
  });
});

describe('StemMixClock loop wrap together', () => {
  function playing() {
    const ch = channels();
    let now = 100;
    const clock = new StemMixClock(ch.list, 60, () => now);
    const elements = ch.list.map((c) => c.element as FakeAudio);
    clock.setLoop({ start: 10, end: 12 });
    clock.seek(11.9);
    clock.play();
    return { ch, clock, elements, advance: (s: number) => (now += s) };
  }

  it('covers AE6: on a wrap every follower is with the leader at once, with no timer tick between', () => {
    const { clock, elements } = playing();
    for (const e of elements) {
      e.paused = false;
      e.currentTime = 12.1;
    }
    clock.time(); // the leader wraps
    for (const e of elements) expect(e.currentTime).toBeCloseTo(10, 6);
  });

  it('covers AE6: the pass number runs 1 to 5 over five wraps and is not moved by a seek, a pause or a tempo change', () => {
    const { clock, elements } = playing();
    const wrap = () => {
      elements[0].currentTime = 12.1;
      clock.time();
    };
    const seen = [clock.pass];
    for (let i = 0; i < 4; i++) {
      wrap();
      seen.push(clock.pass);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
    clock.seek(10.5);
    clock.setRate(0.5);
    clock.pause();
    clock.play();
    expect(clock.pass).toBe(5);
  });

  it('turning the loop off mid-pass leaves every follower with the leader', () => {
    const { clock, elements, advance } = playing();
    for (const e of elements) e.paused = false;
    clock.setLoop(null);
    advance(0.5);
    for (const e of elements) e.currentTime += 0.5;
    clock.time();
    clock.resync();
    for (const e of elements) expect(Math.abs(e.currentTime - elements[0].currentTime)).toBeLessThan(0.04);
    expect(elements[0].currentTime).toBeGreaterThan(12);
  });

  it('a wrap during the lead-in leaves followers paused', () => {
    const ch = channels();
    let now = 50;
    const clock = new StemMixClock(ch.list, 60, () => now);
    clock.setOffset(-5);
    clock.setLoop({ start: 0, end: 2 });
    clock.seek(0);
    clock.play();
    now += 2.5;
    clock.time();
    expect(clock.pass).toBe(2);
    for (const c of ch.list) expect((c.element as FakeAudio).paused).toBe(true);
  });
});

describe('StemMixClock with holds', () => {
  const map = () => AlignmentMap.of(1.5, [{ at: 40, length: 8 }]);

  it('exposes the map of the leading stem and seeks every stem to the same recording position through it', () => {
    const { list } = channels();
    const clock = new StemMixClock(list, 100);
    clock.setAlignment(map());
    expect(clock.alignment.holds).toEqual([{ at: 40, length: 8 }]);
    expect(clock.offset).toBe(1.5);
    clock.seek(45);
    for (const c of list) expect((c.element as FakeAudio).currentTime).toBeCloseTo(54.5, 9);
    expect(clock.time()).toBeCloseTo(45, 9);
  });

  it('wraps a loop that spans the extra playing with every stem together and counts one pass', () => {
    const ch = channels();
    let now = 100;
    const clock = new StemMixClock(ch.list, 100, () => now);
    const elements = ch.list.map((c) => c.element as FakeAudio);
    clock.setAlignment(map());
    clock.setLoop({ start: 35, end: 45 });
    clock.seek(36);
    clock.play();
    for (const e of elements) {
      e.paused = false;
      e.currentTime = 45; // inside the extra playing: no wrap
    }
    clock.time();
    expect(clock.pass).toBe(1);
    expect(elements[0].currentTime).toBe(45);
    for (const e of elements) e.currentTime = 54.5;
    clock.time();
    expect(clock.pass).toBe(2);
    for (const e of elements) expect(e.currentTime).toBeCloseTo(36.5, 6);
  });
});
