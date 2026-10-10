import { describe, expect, it, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { programGain } from '../../src/audio/track-balance';
import { SynthClock } from '../../src/audio/synth-bridge';

describe('programGain', () => {
  it('brings the quiet distorted guitars up and the loud clean one down', () => {
    expect(programGain(30)).toBeGreaterThan(2);
    expect(programGain(29)).toBeGreaterThan(2);
    expect(programGain(27)).toBeLessThan(0.5);
  });

  it('leaves every sound that is not tuned at its own level', () => {
    for (const program of [0, 2, 33, 48, 80, 118, 127]) expect(programGain(program)).toBe(1);
  });

  it('keeps every gain within a sensible range', () => {
    for (let program = 0; program < 128; program++) {
      const gain = programGain(program);
      expect(gain).toBeGreaterThanOrEqual(0.3);
      expect(gain).toBeLessThanOrEqual(4);
    }
  });

  it('puts the clean and distorted guitars at about the same level', () => {
    // Levels measured alone: clean 0.1875, distortion 0.0185. After their gains they should be close.
    const clean = 0.1875 * programGain(27);
    const distortion = 0.0185 * programGain(30);
    expect(Math.abs(20 * Math.log10(clean / distortion))).toBeLessThan(3);
  });
});

type Handler<T> = (e: T) => void;

function emitter<T>() {
  const handlers: Handler<T>[] = [];
  return {
    on: (h: Handler<T>) => {
      handlers.push(h);
      return () => handlers.splice(handlers.indexOf(h), 1);
    },
    emit: (e: T) => [...handlers].forEach((h) => h(e)),
  };
}

function setup(programs: number[]) {
  const ready = emitter<void>();
  const tracks = programs.map((program, index) => ({
    index,
    playbackInfo: { program },
    staves: [{ bars: [{ voices: [{ beats: [{ automations: [{ type: alphaTab.model.AutomationType.Instrument, value: program }] }] }] }] }],
  }));
  const seen: Map<number, number>[] = [];
  const api = {
    playerPositionChanged: emitter<{ currentTick: number }>(),
    playerStateChanged: emitter<{ state: number }>(),
    playerReady: ready,
    destroy: vi.fn(),
    play: vi.fn(),
    tickPosition: 0,
    playbackSpeed: 1,
    playbackRange: null as unknown,
    isLooping: false,
    score: { tracks },
    loadMidiForScore: vi.fn(),
    changeTrackMute: vi.fn(),
    changeTrackVolume: vi.fn(),
    exportAudio: vi.fn(async (options: { trackVolume: Map<number, number> }) => {
      seen.push(new Map(options.trackVolume));
      return { render: async () => null, destroy: vi.fn() };
    }),
  };
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, [{ tick: 0, tempo: 120 }], 0);
  return { api, clock, ready, tracks, seen };
}

const levels = (api: { changeTrackVolume: ReturnType<typeof vi.fn> }) =>
  api.changeTrackVolume.mock.calls.map(([tracks, gain]) => [(tracks as { index: number }[])[0].index, gain]);

describe('SynthClock levels', () => {
  it('sets each guitar to its level when the synth is ready, and leaves other tracks alone', () => {
    const { api, ready } = setup([30, 33, 27]);
    ready.emit();
    expect(levels(api)).toEqual([
      [0, programGain(30)],
      [2, programGain(27)],
    ]);
  });

  it('sets them again after a tone change, from the new program', () => {
    const { api, clock, ready } = setup([30, 33]);
    ready.emit();
    api.changeTrackVolume.mockClear();
    clock.setTrackPrograms(new Map([[0, 27]]));
    ready.emit();
    expect(levels(api)).toEqual([[0, programGain(27)]]);
  });

  it('sets a track back to 1 when it no longer plays a tuned sound', () => {
    const { api, clock, ready } = setup([30]);
    ready.emit();
    api.changeTrackVolume.mockClear();
    clock.setTrackPrograms(new Map([[0, 33]]));
    ready.emit();
    expect(levels(api)).toEqual([[0, 1]]);
  });

  it('applies the same levels to the export', async () => {
    const { clock, seen } = setup([30, 33, 27]);
    await clock.exportAudio(undefined, { effects: false });
    expect(seen[0].get(0)).toBe(programGain(30));
    expect(seen[0].get(2)).toBe(programGain(27));
    expect(seen[0].has(1)).toBe(false);
  });

  it('still leaves a silenced track out of the export', async () => {
    const { clock, seen } = setup([30, 30]);
    clock.setSilentTrack(1);
    await clock.exportAudio(undefined, { effects: false });
    expect(seen[0].get(1)).toBe(0);
    expect(seen[0].get(0)).toBe(programGain(30));
  });
});
