import { describe, expect, it, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { activeLevels, mergeLevels, programGain, setActiveLevels } from '../../src/audio/track-balance';
import { BUNDLED_BANKS } from '../../src/audio/bank-manifest';
import { SynthClock } from '../../src/audio/synth-bridge';

/** The fixed table the gains came from before every bank was levelled (programs 24 to 31, MuseScore General). */
const TODAY: Record<number, number> = { 24: 0.0475, 25: 0.0205, 26: 0.0233, 27: 0.1875, 28: 0.0855, 29: 0.0164, 30: 0.0185, 31: 0.0243 };
const museScore = () => BUNDLED_BANKS.find((bank) => bank.id === 'musescore-general')!.levels;

describe('programGain', () => {
  it('brings the quiet distorted guitars up and the loud clean one down', () => {
    expect(programGain(30)).toBeGreaterThan(2);
    expect(programGain(29)).toBeGreaterThan(2);
    expect(programGain(27)).toBeLessThan(0.5);
  });

  it('leaves every sound that is not tuned at its own level', () => {
    for (const program of [0, 2, 23, 35, 48, 80, 118, 127]) expect(programGain(program)).toBe(1);
  });

  it('gives the guitars the same gains as the fixed table did, with only MuseScore General levels', () => {
    const levels = mergeLevels([museScore()]);
    for (const [program, level] of Object.entries(TODAY)) {
      const expected = Math.min(4, Math.max(0.3, 0.06 / level));
      expect(programGain(Number(program), levels)).toBe(expected);
      expect(programGain(Number(program))).toBe(expected);
    }
  });

  it("lets a player's bank override the bundled level only for the programs it covers", () => {
    const levels = mergeLevels([museScore(), { 30: 0.03 }]);
    expect(programGain(30, levels)).toBeCloseTo(2, 10);
    for (const program of [24, 25, 26, 27, 28, 29, 31, 32, 33, 34]) {
      expect(programGain(program, levels)).toBe(programGain(program, mergeLevels([museScore()])));
    }
  });

  it('takes the later of two banks for a program both cover, in layering order', () => {
    const levels = mergeLevels([{ 27: 0.12 }, { 27: 0.03 }, { 29: 0.02 }]);
    expect(levels[27]).toBe(0.03);
    expect(levels[29]).toBe(0.02);
  });

  it('ignores a silent or broken level instead of letting it win', () => {
    const levels = mergeLevels([{ 30: 0.03 }, { 30: 0 }, { 30: Number.NaN }, { 30: -1 }]);
    expect(levels[30]).toBe(0.03);
    expect(programGain(31, { 31: 0 })).toBe(1);
  });

  it('levels bass 32 to 34 from the table, and leaves other programs at 1', () => {
    const levels = { 32: 0.05, 33: 0.2, 34: 0.1, 35: 0.05, 40: 0.05 };
    expect(programGain(32, levels)).not.toBe(1);
    expect(programGain(33, levels)).not.toBe(1);
    expect(programGain(34, levels)).not.toBe(1);
    // A louder bass gets a smaller gain.
    expect(programGain(33, levels)).toBeLessThan(programGain(34, levels));
    expect(programGain(34, levels)).toBeLessThan(programGain(32, levels));
    expect(programGain(35, levels)).toBe(1);
    expect(programGain(40, levels)).toBe(1);
    expect(programGain(33, {})).toBe(1);
  });

  it("keeps MuseScore General's bass at about today's level", () => {
    // Bass was never levelled before, so its gains stay near 1 rather than being pulled to the guitars' level.
    for (const program of [32, 33, 34]) {
      expect(museScore()[program]).toBeGreaterThan(0);
      const gain = programGain(program);
      expect(Math.abs(20 * Math.log10(gain))).toBeLessThan(3);
    }
  });

  it('clamps every gain to 0.3 to 4', () => {
    expect(programGain(30, { 30: 0.0001 })).toBe(4);
    expect(programGain(27, { 27: 5 })).toBe(0.3);
    expect(programGain(33, { 33: 0.0001 })).toBe(4);
    expect(programGain(33, { 33: 5 })).toBe(0.3);
  });

  it("uses the active banks' levels by default, and can be set back to the bundled ones", () => {
    const bundled = activeLevels();
    try {
      setActiveLevels([museScore(), { 30: 0.03 }]);
      expect(programGain(30)).toBeCloseTo(2, 10);
      expect(programGain(27)).toBe(programGain(27, bundled));
    } finally {
      setActiveLevels(BUNDLED_BANKS.map((bank) => bank.levels));
    }
    expect(activeLevels()).toEqual(bundled);
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
