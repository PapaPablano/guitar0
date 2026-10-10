import { describe, expect, it, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { SynthClock } from '../../src/audio/synth-bridge';
import { AUDIO_SAMPLE_RATE } from '../../src/export/presets';

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

/** A track whose first beat carries the opening instrument change, as alphaTab builds it, plus one mid-song change. */
function trackWith(program: number, index: number) {
  const opening = { type: alphaTab.model.AutomationType.Instrument, value: program };
  const later = { type: alphaTab.model.AutomationType.Instrument, value: program + 1 };
  const tempo = { type: alphaTab.model.AutomationType.Tempo, value: 120 };
  return {
    index,
    playbackInfo: { program },
    staves: [{ bars: [{ voices: [{ beats: [{ automations: [opening, tempo] }, { automations: [later] }] }] }] }],
    opening,
    later,
  };
}

function setup() {
  const ready = emitter<void>(true);
  const state = emitter<{ state: number }>();
  const tracks = [trackWith(30, 0), trackWith(33, 1), trackWith(27, 2)];
  const exported: { programs: number[]; firstBeat: number[]; sampleRate: number }[] = [];
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
    // Records what the score says at the moment the export is requested, as alphaTab builds its audio from it then.
    exportAudio: vi.fn(async (options: { sampleRate: number }) => {
      const seen = { programs: tracks.map((t) => t.playbackInfo.program), firstBeat: tracks.map((t) => t.opening.value), sampleRate: options.sampleRate };
      exported.push(seen);
      const chunks = [{ samples: new Float32Array(8), currentTime: 1, endTime: 2 }, { samples: new Float32Array(8), currentTime: 2, endTime: 2 }];
      return { render: async () => chunks.shift() ?? null, destroy: vi.fn() };
    }),
  };
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, TEMPO, 0);
  return { api, clock, ready, state, tracks, exported };
}

describe('SynthClock guitar tones', () => {
  it('sets the track program and every instrument change in it, and asks for a rebuild', () => {
    const { clock, api, tracks } = setup();
    clock.setTrackPrograms(new Map([[2, 30]]));
    expect(tracks[2].playbackInfo.program).toBe(30);
    expect(tracks[2].opening.value).toBe(30);
    expect(tracks[2].later.value).toBe(30);
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(1);
  });

  it('leaves other tracks and non-instrument changes alone', () => {
    const { clock, tracks } = setup();
    clock.setTrackPrograms(new Map([[2, 30]]));
    expect(tracks[0].playbackInfo.program).toBe(30);
    expect(tracks[1].playbackInfo.program).toBe(33);
    expect(tracks[1].opening.value).toBe(33);
    expect(tracks[2].staves[0].bars[0].voices[0].beats[0].automations[1].value).toBe(120);
  });

  it('puts back what the tab wrote when the tone is cleared', () => {
    const { clock, api, ready, tracks } = setup();
    clock.setTrackPrograms(new Map([[2, 30]]));
    ready.emit();
    api.loadMidiForScore.mockClear();
    clock.setTrackPrograms(new Map());
    expect(tracks[2].playbackInfo.program).toBe(27);
    expect(tracks[2].opening.value).toBe(27);
    expect(tracks[2].later.value).toBe(28);
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(1);
  });

  it('does not rebuild when nothing changed', () => {
    const { clock, api, ready } = setup();
    clock.setTrackPrograms(new Map());
    expect(api.loadMidiForScore).not.toHaveBeenCalled();
    clock.setTrackPrograms(new Map([[2, 30]]));
    ready.emit();
    api.loadMidiForScore.mockClear();
    clock.setTrackPrograms(new Map([[2, 30]]));
    expect(api.loadMidiForScore).not.toHaveBeenCalled();
  });

  it('changes two tracks in one rebuild and moves one without touching the other', () => {
    const { clock, api, tracks } = setup();
    clock.setTrackPrograms(
      new Map([
        [0, 27],
        [2, 29],
      ]),
    );
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(1);
    clock.setTrackPrograms(
      new Map([
        [0, 27],
        [2, 30],
      ]),
    );
    expect(tracks[0].playbackInfo.program).toBe(27);
    expect(tracks[2].playbackInfo.program).toBe(30);
  });

  it('forces the chosen tone even when it equals the written program', () => {
    const { clock, tracks } = setup();
    clock.setTrackPrograms(new Map([[0, 30]]));
    expect(tracks[0].later.value).toBe(30);
    clock.setTrackPrograms(new Map());
    expect(tracks[0].later.value).toBe(31);
  });

  it('keeps the position, speed and loop, and resumes playing, once the rebuilt audio is ready', () => {
    const { clock, api, ready, state } = setup();
    clock.setRate(0.5);
    clock.setLoop({ start: 2, end: 4, startTick: 3840, endTick: 7680 });
    clock.seek(3);
    state.emit({ state: alphaTab.synth.PlayerState.Playing });
    clock.setTrackPrograms(new Map([[2, 30]]));
    // The synth stops and rewinds while it loads the new audio.
    state.emit({ state: alphaTab.synth.PlayerState.Paused });
    api.tickPosition = 0;
    api.playbackRange = null;
    api.isLooping = false;
    api.play.mockClear();
    ready.emit();
    // 3 s is 5760 ticks; the clock keeps running while it plays, so the restored position is at or just past that.
    expect(api.tickPosition).toBeGreaterThanOrEqual(5760);
    expect(api.tickPosition).toBeLessThan(5760 + 1920);
    expect(api.playbackSpeed).toBe(0.5);
    expect(api.isLooping).toBe(true);
    expect((api.playbackRange as { startTick: number; endTick: number }).startTick).toBe(3840);
    expect(api.play).toHaveBeenCalledTimes(1);
  });

  it('stays paused after a rebuild when it was paused', () => {
    const { clock, api, ready } = setup();
    clock.seek(1);
    api.tickPosition = 0;
    clock.setTrackPrograms(new Map([[2, 30]]));
    ready.emit();
    expect(api.tickPosition).toBe(1920);
    expect(api.play).not.toHaveBeenCalled();
  });

  it('folds changes made during a rebuild into one more rebuild', () => {
    const { clock, api, ready } = setup();
    clock.setTrackPrograms(new Map([[2, 30]]));
    clock.setTrackPrograms(new Map([[2, 29]]));
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(1);
    ready.emit();
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(2);
    ready.emit();
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(2);
  });

  it('ignores a track the song does not have', () => {
    const { clock, api } = setup();
    clock.setTrackPrograms(new Map([[9, 30]]));
    expect(api.loadMidiForScore).not.toHaveBeenCalled();
  });

  describe('export', () => {
    it('is built from the chosen tone, even before the live synth has finished rebuilding', async () => {
      const { clock, exported } = setup();
      clock.setTrackPrograms(new Map([[2, 30]]));
      await clock.exportAudio();
      expect(exported[0].programs).toEqual([30, 33, 30]);
      expect(exported[0].firstBeat[2]).toBe(30);
    });

    it('goes back to the written sound once the tone is cleared', async () => {
      const { clock, exported } = setup();
      clock.setTrackPrograms(new Map([[2, 30]]));
      clock.setTrackPrograms(new Map());
      await clock.exportAudio();
      expect(exported[0].programs).toEqual([30, 33, 27]);
      expect(exported[0].firstBeat[2]).toBe(27);
    });

    it('keeps the sample rate, and the length is the length rendered', async () => {
      const { clock, exported } = setup();
      const pcm = await clock.exportAudio();
      expect(exported[0].sampleRate).toBe(AUDIO_SAMPLE_RATE);
      expect(pcm.sampleRate).toBe(AUDIO_SAMPLE_RATE);
      expect(pcm.left.length).toBe(8);
    });
  });
});
