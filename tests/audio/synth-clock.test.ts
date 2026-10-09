import { describe, expect, it, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { SynthClock } from '../../src/audio/synth-bridge';
import { AUDIO_SAMPLE_RATE } from '../../src/export/presets';

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
  const ready = emitter<void>();
  const api = {
    playerPositionChanged: position,
    playerStateChanged: state,
    playerReady: ready,
    play: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    tickPosition: 0,
    playbackSpeed: 1,
    playbackRange: null as unknown,
    isLooping: false,
    score: { tracks: [{ index: 0 }, { index: 1 }, { index: 2 }] },
    changeTrackMute: vi.fn(),
    exportAudio: vi.fn(async (_options: unknown) => ({ render: async () => null, destroy: vi.fn() })),
  };
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, TEMPO, latency);
  return { api, clock, position, state, ready };
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

  it('keeps the heard position steady when the tempo changes while playing', () => {
    const perf = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { clock, position, state } = setup(0.04);
    state.emit({ state: alphaTab.synth.PlayerState.Playing });
    position.emit({ currentTick: 1920 * 4 });
    const before = clock.time();
    clock.setRate(0.5);
    // the latency is taken off once, not folded into the stored position as well
    expect(clock.time()).toBeCloseTo(4 - 0.04 * 0.5, 6);
    expect(before).toBeCloseTo(4 - 0.04, 6);
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

  describe('silencing one track', () => {
    const muted = (api: { changeTrackMute: ReturnType<typeof vi.fn> }) =>
      api.changeTrackMute.mock.calls.map(([tracks, mute]) => [(tracks as { index: number }[]).map((t) => t.index), mute]);

    it('mutes only the named track', () => {
      const { clock, api } = setup();
      clock.setSilentTrack(1);
      expect(muted(api)).toEqual([[[1], true]]);
    });

    it('unmutes the previous track when it moves to another', () => {
      const { clock, api } = setup();
      clock.setSilentTrack(1);
      api.changeTrackMute.mockClear();
      clock.setSilentTrack(2);
      expect(muted(api)).toEqual([[[1], false], [[2], true]]);
    });

    it('unmutes everything when cleared, and does nothing when already clear', () => {
      const { clock, api } = setup();
      clock.setSilentTrack(1);
      api.changeTrackMute.mockClear();
      clock.setSilentTrack(null);
      expect(muted(api)).toEqual([[[1], false]]);
      api.changeTrackMute.mockClear();
      clock.setSilentTrack(null);
      expect(api.changeTrackMute).not.toHaveBeenCalled();
    });

    it('mutes it again when playback starts, in case the synth was not ready the first time', () => {
      const { clock, api, state } = setup();
      clock.setSilentTrack(1);
      api.changeTrackMute.mockClear();
      state.emit({ state: alphaTab.synth.PlayerState.Playing });
      expect(muted(api)).toEqual([[[1], true]]);
    });

    it('mutes it again when the synth reports ready, and not when no track is silent', () => {
      const { clock, api, ready } = setup();
      ready.emit();
      expect(api.changeTrackMute).not.toHaveBeenCalled();
      clock.setSilentTrack(1);
      api.changeTrackMute.mockClear();
      ready.emit();
      expect(muted(api)).toEqual([[[1], true]]);
    });

    it('does not mute anything at playback when no track is silent', () => {
      const { api, state } = setup();
      state.emit({ state: alphaTab.synth.PlayerState.Playing });
      expect(api.changeTrackMute).not.toHaveBeenCalled();
    });

    it('ignores a track the song does not have', () => {
      const { clock, api } = setup();
      clock.setSilentTrack(9);
      expect(api.changeTrackMute).not.toHaveBeenCalled();
    });

    it('leaves the silenced track out of the export', async () => {
      const { clock, api } = setup();
      clock.setSilentTrack(1);
      await clock.exportAudio();
      const options = api.exportAudio.mock.calls[0]![0] as alphaTab.synth.AudioExportOptions;
      expect(options.trackVolume.get(1)).toBe(0);
      expect(options.trackVolume.size).toBe(1);
    });

    it('exports the full band when asked, whatever is silenced', async () => {
      const { clock, api } = setup();
      clock.setSilentTrack(1);
      await clock.exportAudio(undefined, { fullBand: true });
      const options = api.exportAudio.mock.calls[0]![0] as alphaTab.synth.AudioExportOptions;
      expect(options.trackVolume.size).toBe(0);
    });

    it('keeps the export length and rate unchanged', async () => {
      const { clock } = setup();
      clock.setSilentTrack(1);
      const pcm = await clock.exportAudio();
      expect(pcm.sampleRate).toBe(AUDIO_SAMPLE_RATE);
      expect(pcm.left.length).toBe(0);
    });
  });
});
