import { describe, expect, it, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { SynthClock } from '../../src/audio/synth-bridge';

type Handler<T> = (e: T) => void;

function emitter<T>() {
  const handlers: Handler<T>[] = [];
  return {
    on: (h: Handler<T>) => handlers.push(h),
    emit: (e: T) => handlers.forEach((h) => h(e)),
  };
}

// 120 bpm throughout: one second is 1920 ticks
const TEMPO = [{ tick: 0, tempo: 120 }];

function setup(latency = 0) {
  const position = emitter<{ currentTick: number }>();
  const state = emitter<{ state: number }>();
  const api = {
    playerPositionChanged: position,
    playerStateChanged: state,
    play: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    tickPosition: 0,
    playbackSpeed: 1,
    playbackRange: null as unknown,
    isLooping: false,
  };
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, TEMPO, latency);
  return { api, clock, position, state };
}

describe('SynthClock', () => {
  it('reports the synth position converted through the tempo map', () => {
    const { clock, position } = setup();
    position.emit({ currentTick: 1920 * 5 });
    expect(clock.time()).toBeCloseTo(5, 6);
  });

  it('interpolates between position reports while playing, scaled by the tempo rate', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const perf = vi.spyOn(performance, 'now');
      perf.mockReturnValue(1000);
      const { clock, position, state } = setup();
      clock.setRate(0.5);
      state.emit({ state: alphaTab.synth.PlayerState.Playing });
      position.emit({ currentTick: 1920 * 2 });
      perf.mockReturnValue(3000); // two real seconds later, at half speed
      expect(clock.time()).toBeCloseTo(3, 6);
      perf.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the output latency off the position while playing', () => {
    const perf = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { clock, position, state } = setup(0.04);
    state.emit({ state: alphaTab.synth.PlayerState.Playing });
    position.emit({ currentTick: 1920 * 4 });
    expect(clock.time()).toBeCloseTo(4 - 0.04, 6);
    perf.mockRestore();
  });

  it('seeks by tick and clamps to the song', () => {
    const { clock, api } = setup();
    clock.seek(3);
    expect(api.tickPosition).toBeCloseTo(1920 * 3, 6);
    clock.seek(500);
    expect(clock.time()).toBe(60);
  });

  it('hands a loop to the synth as a tick range and clears it again', () => {
    const { clock, api } = setup();
    clock.setLoop({ start: 2, end: 4, startTick: 3840, endTick: 7680 });
    expect(api.isLooping).toBe(true);
    expect(api.playbackRange).toMatchObject({ startTick: 3840, endTick: 7680 });
    clock.setLoop(null);
    expect(api.isLooping).toBe(false);
    expect(api.playbackRange).toBeNull();
  });

  it('follows the synth play state', () => {
    const { clock, state } = setup();
    expect(clock.playing).toBe(false);
    state.emit({ state: alphaTab.synth.PlayerState.Playing });
    expect(clock.playing).toBe(true);
    state.emit({ state: alphaTab.synth.PlayerState.Paused });
    expect(clock.playing).toBe(false);
  });
});
