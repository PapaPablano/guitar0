import { describe, expect, it, vi } from 'vitest';
import { StemMixClock, type StemChannel } from '../../src/audio/stem-mix';
import type { AudioLike } from '../../src/audio/user-audio';
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

  it('releases every channel on dispose', () => {
    const { list } = channels();
    new StemMixClock(list, 60).dispose();
    for (const c of list) expect(c.dispose).toHaveBeenCalled();
  });
});
