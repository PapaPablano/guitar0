import { describe, expect, it, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { SynthClock } from '../../src/audio/synth-bridge';

type Handler<T> = (e: T) => void;

/** Like alphaTab's: with `fireOnRegister`, a handler added while the synth is already ready is called at once. */
function emitter<T>(fireOnRegister = false) {
  const handlers: Handler<T>[] = [];
  return {
    on: (h: Handler<T>) => {
      handlers.push(h);
      if (fireOnRegister) (h as () => void)();
      return () => handlers.splice(handlers.indexOf(h), 1);
    },
    emit: (e: T) => [...handlers].forEach((h) => h(e)),
  };
}

const TEMPO = [{ tick: 0, tempo: 120 }]; // one second is 1920 ticks
const Playing = alphaTab.synth.PlayerState.Playing;
const Paused = alphaTab.synth.PlayerState.Paused;

/** A track whose first beat carries the opening instrument change, as alphaTab builds it, plus one mid-song change. */
function trackWith(program: number, index: number) {
  const opening = { type: alphaTab.model.AutomationType.Instrument, value: program };
  const later = { type: alphaTab.model.AutomationType.Instrument, value: program + 1 };
  return {
    index,
    playbackInfo: { program },
    staves: [{ bars: [{ voices: [{ beats: [{ automations: [opening] }, { automations: [later] }] }] }] }],
    opening,
    later,
  };
}

function setup(tracks = [trackWith(30, 0), trackWith(33, 1), trackWith(27, 2)]) {
  const ready = emitter<void>(true);
  const state = emitter<{ state: number }>();
  const api = {
    playerPositionChanged: emitter<{ currentTick: number }>(),
    playerStateChanged: state,
    playerReady: ready,
    play: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    tickPosition: 0,
    playbackSpeed: 1,
    playbackRange: null as unknown,
    isLooping: false,
    score: { tracks },
    loadMidiForScore: vi.fn(),
  };
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, TEMPO, 0);
  return { api, clock, ready, state, tracks };
}

describe('SynthClock tone rebuilds', () => {
  it("puts the tab's sound back from a second clock over a score the first clock already changed", () => {
    const first = setup();
    first.clock.setTrackPrograms(new Map([[2, 30]]));
    // A tuning change or a retry builds a new clock over the same score.
    const second = setup(first.tracks);
    second.clock.setTrackPrograms(new Map());
    expect(first.tracks[2].playbackInfo.program).toBe(27);
    expect(first.tracks[2].opening.value).toBe(27);
    expect(first.tracks[2].later.value).toBe(28);
    expect(second.api.loadMidiForScore).toHaveBeenCalledTimes(1);
  });

  it('keeps playing through two changes made during one rebuild', () => {
    const { clock, api, ready, state } = setup();
    clock.seek(3);
    state.emit({ state: Playing });
    clock.setTrackPrograms(new Map([[2, 30]]));
    state.emit({ state: Paused });
    clock.setTrackPrograms(new Map([[2, 29]]));
    api.play.mockClear();
    ready.emit();
    expect(api.play).not.toHaveBeenCalled();
    ready.emit();
    expect(api.play).toHaveBeenCalledTimes(1);
  });

  it('keeps a seek made during a rebuild instead of restoring the old position', () => {
    const { clock, api, ready } = setup();
    clock.seek(1);
    clock.setTrackPrograms(new Map([[2, 30]]));
    clock.seek(4);
    api.tickPosition = 0;
    ready.emit();
    expect(api.tickPosition).toBe(7680);
    expect(clock.time()).toBeCloseTo(4, 3);
  });

  it('plays after a rebuild when play was pressed during it', () => {
    const { clock, api, ready } = setup();
    clock.setTrackPrograms(new Map([[2, 30]]));
    clock.play();
    expect(api.play).not.toHaveBeenCalled();
    ready.emit();
    expect(api.play).toHaveBeenCalledTimes(1);
  });

  it('stays paused after a rebuild when pause was pressed during it', () => {
    const { clock, api, ready, state } = setup();
    clock.seek(2);
    state.emit({ state: Playing });
    clock.setTrackPrograms(new Map([[2, 30]]));
    clock.pause();
    expect(api.pause).not.toHaveBeenCalled();
    state.emit({ state: Paused });
    api.play.mockClear();
    ready.emit();
    expect(api.play).not.toHaveBeenCalled();
  });

  it('gives up on a rebuild that never finishes, so the next change still gets through', () => {
    vi.useFakeTimers();
    try {
      const { clock, api } = setup();
      clock.setTrackPrograms(new Map([[2, 30]]));
      expect(api.loadMidiForScore).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(25_000);
      clock.setTrackPrograms(new Map([[2, 29]]));
      expect(api.loadMidiForScore).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not stuck after alphaTab throws while loading the audio', () => {
    const { clock, api } = setup();
    api.loadMidiForScore.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    clock.setTrackPrograms(new Map([[2, 30]]));
    clock.setTrackPrograms(new Map([[2, 29]]));
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(2);
  });

  it('does nothing more once disposed, even if the rebuild finishes', () => {
    const { clock, api, ready } = setup();
    clock.setTrackPrograms(new Map([[2, 30]]));
    clock.dispose();
    api.play.mockClear();
    ready.emit();
    expect(api.play).not.toHaveBeenCalled();
    api.loadMidiForScore.mockClear();
    clock.setTrackPrograms(new Map([[2, 29]]));
    expect(api.loadMidiForScore).not.toHaveBeenCalled();
  });
});
