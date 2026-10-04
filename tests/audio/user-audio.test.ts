import { describe, expect, it } from 'vitest';
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
    clock.setOffset(-2);
    // the recording stays put, so the tab time moves
    expect(clock.time()).toBeCloseTo(13.5, 9);
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

describe('loadUserAudio', () => {
  it('rejects a recording over the size limit before reading it', async () => {
    const big = new File([new Uint8Array(8)], 'big.wav');
    Object.defineProperty(big, 'size', { value: MAX_AUDIO_BYTES + 1 });
    await expect(loadUserAudio(big, 10)).rejects.toThrow(/too large/);
  });
});
