import { describe, expect, it } from 'vitest';
import { PlaybackClock } from '../../src/audio/clock';

function setup(duration = 20) {
  let now = 100;
  const clock = new PlaybackClock(() => now, duration);
  return { clock, advance: (s: number) => (now += s) };
}

describe('PlaybackClock', () => {
  it('stays put while paused', () => {
    const { clock, advance } = setup();
    advance(5);
    expect(clock.time()).toBe(0);
  });

  it('advances in real time while playing', () => {
    const { clock, advance } = setup();
    clock.play();
    advance(3);
    expect(clock.time()).toBeCloseTo(3, 9);
  });

  it('advances at half speed at 50% tempo', () => {
    const { clock, advance } = setup();
    clock.setRate(0.5);
    clock.play();
    advance(4);
    expect(clock.time()).toBeCloseTo(2, 9);
  });

  it('keeps the position when the tempo changes mid-playback', () => {
    const { clock, advance } = setup();
    clock.play();
    advance(2);
    clock.setRate(0.5);
    expect(clock.time()).toBeCloseTo(2, 9);
    advance(2);
    expect(clock.time()).toBeCloseTo(3, 9);
  });

  it('seeks while paused and while playing', () => {
    const { clock, advance } = setup();
    clock.seek(7);
    expect(clock.time()).toBe(7);
    clock.play();
    advance(1);
    clock.seek(2);
    advance(1);
    expect(clock.time()).toBeCloseTo(3, 9);
  });

  it('clamps seeks to the song', () => {
    const { clock } = setup();
    clock.seek(-5);
    expect(clock.time()).toBe(0);
    clock.seek(99);
    expect(clock.time()).toBe(20);
  });

  it('wraps to the loop start without overshooting', () => {
    const { clock, advance } = setup();
    clock.setLoop({ start: 4, end: 8 });
    clock.seek(4);
    clock.play();
    advance(4.5);
    expect(clock.time()).toBeCloseTo(4.5, 9);
    // 4.5 + 7.75 = 12.25 s of unwrapped media time, which folds into the 4 s loop as 4.25 s
    advance(3.5 + 4 + 0.25);
    expect(clock.time()).toBeCloseTo(4.25, 6);
  });

  it('stops at the end of the song', () => {
    const { clock, advance } = setup(10);
    clock.play();
    advance(30);
    expect(clock.time()).toBe(10);
    expect(clock.playing).toBe(false);
  });

  it('restarts from the beginning when played at the end', () => {
    const { clock, advance } = setup(10);
    clock.seek(10);
    clock.play();
    advance(1);
    expect(clock.time()).toBeCloseTo(1, 9);
  });

  it('ignores an empty loop range', () => {
    const { clock } = setup();
    clock.setLoop({ start: 5, end: 5 });
    expect(clock.loop).toBeNull();
  });
});
