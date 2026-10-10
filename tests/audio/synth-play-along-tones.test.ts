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

function trackWith(program: number, index: number) {
  const opening = { type: alphaTab.model.AutomationType.Instrument, value: program };
  return { index, playbackInfo: { program }, staves: [{ bars: [{ voices: [{ beats: [{ automations: [opening] }] }] }] }] };
}

function setup() {
  const ready = emitter<void>(false);
  const tracks = [trackWith(30, 0), trackWith(33, 1), trackWith(27, 2)];
  const api = {
    playerPositionChanged: emitter<{ currentTick: number }>(),
    playerStateChanged: emitter<{ state: number }>(),
    playerReady: ready,
    play: vi.fn(),
    destroy: vi.fn(),
    tickPosition: 0,
    playbackSpeed: 1,
    playbackRange: null as unknown,
    isLooping: false,
    score: { tracks },
    loadMidiForScore: vi.fn(),
    changeTrackMute: vi.fn(),
    exportAudio: vi.fn(async (options: { trackVolume: Map<number, number> }) => {
      seen.push(new Map(options.trackVolume));
      return { render: async () => null, destroy: vi.fn() };
    }),
  };
  const seen: Map<number, number>[] = [];
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, [{ tick: 0, tempo: 120 }], 0);
  return { api, clock, ready, tracks, seen };
}

describe('Play along together with the guitar tone switch', () => {
  it('silences the track again once the rebuilt audio is ready after a tone change', () => {
    const { api, clock, ready, tracks } = setup();
    clock.setSilentTrack(1);
    clock.setTrackPrograms(new Map([[0, 29]]));
    api.changeTrackMute.mockClear();
    ready.emit();
    expect(api.changeTrackMute).toHaveBeenCalledWith([tracks[1]], true);
  });

  it('leaves the silenced track out of the export and still applies the tone', async () => {
    const { clock, tracks, seen } = setup();
    clock.setSilentTrack(1);
    clock.setTrackPrograms(new Map([[0, 29]]));
    await clock.exportAudio(undefined, { effects: false });
    expect(seen[0].get(1)).toBe(0);
    expect(tracks[0].playbackInfo.program).toBe(29);
  });

  it('keeps every track for the alignment even with a tone and a silenced track', async () => {
    const { clock, seen } = setup();
    clock.setSilentTrack(1);
    clock.setTrackPrograms(new Map([[0, 29]]));
    await clock.exportAudio(undefined, { fullBand: true, effects: false });
    expect(seen[0].size).toBe(0);
  });
});
