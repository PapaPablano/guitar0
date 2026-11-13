import { describe, expect, it, vi } from 'vitest';
import { UserBankStore, indexedDbBackend, type UserBankBackend } from '../../src/app/user-bank-store';
import { BUNDLED_BANKS, bundledBankSources, PLAYER_RESERVED_BANK } from '../../src/audio/bank-manifest';
import {
  coveredFamilies,
  familyName,
  holdPlace,
  MAX_USER_BANK_BYTES,
  synthBankOptions,
  UserBankController,
  type PickedFile,
  type UserBankDeps,
} from '../../src/audio/user-bank';
import type { LevelTable } from '../../src/audio/track-balance';
import { buildSoundFont, type FixturePreset } from '../fixtures/soundfonts';

function memoryBackend(): UserBankBackend & { value: unknown } {
  const backend = {
    value: null as unknown,
    read: async () => backend.value,
    write: async (value: unknown) => {
      backend.value = value;
    },
    remove: async () => {
      backend.value = null;
    },
  };
  return backend;
}

const CLEAN_AND_FINGERED: FixturePreset[] = [
  { name: 'Clean Gtr', bank: 0, program: 27, samples: ['mono'] },
  { name: 'Fingered Bass', bank: 0, program: 33, samples: ['mono'] },
  { name: 'Grand Piano', bank: 0, program: 0, samples: ['mono'] },
];
const PIANO_ONLY: FixturePreset[] = [
  { name: 'Grand Piano', bank: 0, program: 0, samples: ['mono'] },
  { name: 'Bright Piano', bank: 0, program: 1, samples: ['mono'] },
];
const WITH_DIST_MUTE: FixturePreset[] = [
  { name: 'Distortion Gtr', bank: 0, program: 30, samples: ['mono'] },
  { name: 'Dist Palm Mute', bank: 5, program: 12, samples: ['mono'] },
];

function file(name: string, bytes: Uint8Array): PickedFile & { reads: number } {
  const picked = {
    name,
    size: bytes.length,
    reads: 0,
    arrayBuffer: async () => {
      picked.reads += 1;
      return bytes.slice().buffer;
    },
  };
  return picked;
}

function setup<B extends UserBankBackend = ReturnType<typeof memoryBackend>>(backend: B = memoryBackend() as unknown as B) {
  const levels: LevelTable[][] = [];
  const measured: { banks: number; programs: readonly number[] }[] = [];
  const deps: UserBankDeps = {
    storage: new UserBankStore(backend),
    bundledBytes: async () => [buildSoundFont([{ name: 'Base', bank: 0, program: 0, samples: ['mono'] }])],
    measure: (banks, programs) => {
      measured.push({ banks: banks.length, programs });
      return Object.fromEntries(programs.map((p) => [p, 0.05]));
    },
    nextFrame: async () => undefined,
    setLevels: (tables) => {
      levels.push([...tables]);
    },
    rebuild: vi.fn(),
  };
  return { controller: new UserBankController(deps), deps, levels, measured, backend };
}

const bundledTables = () => BUNDLED_BANKS.map((bank) => bank.levels);

describe('sound family names', () => {
  it('names every guitar and bass program the filter keeps', () => {
    expect([24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34].map(familyName)).toEqual([
      'Nylon acoustic',
      'Steel acoustic',
      'Jazz electric',
      'Clean electric',
      'Muted electric',
      'Crunch electric',
      'Distortion electric',
      'Harmonics',
      'Acoustic bass',
      'Fingered bass',
      'Picked bass',
    ]);
  });

  it('lists what a bank covers in program order, with its palm mutes after', () => {
    expect(
      coveredFamilies({
        covered: [
          { program: 34, name: 'b' },
          { program: 27, name: 'a' },
        ],
        rejected: [],
        mutedCandidates: [{ tone: 'distortion', bank: PLAYER_RESERVED_BANK, program: 30, name: 'Dist Palm Mute' }],
        disabled: [],
      }),
    ).toBe('Clean electric, Picked bass, Distortion palm mute');
  });
});

describe('loading your own bank', () => {
  it('covers AE3: a piano-only bank is refused, nothing is stored, and the sound is not rebuilt', async () => {
    const { controller, deps, backend, levels } = setup();
    await controller.pick(file('Pianos.sf2', buildSoundFont(PIANO_ONLY)));
    expect(controller.snapshot().notice?.text).toMatch(/no guitar or bass sounds/);
    expect(controller.snapshot().view).toEqual({ kind: 'idle' });
    expect(backend.value).toBeNull();
    expect(deps.rebuild).not.toHaveBeenCalled();
    expect(levels).toEqual([]);
    expect(synthBankOptions(controller.active()).banks).toEqual(bundledBankSources());
  });

  it('refuses unreadable bytes with a message and keeps the bundled sounds', async () => {
    const { controller, deps, backend } = setup();
    await controller.pick(file('broken.sf2', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])));
    expect(controller.snapshot().notice?.text).toMatch(/could not be read/);
    expect(backend.value).toBeNull();
    expect(deps.rebuild).not.toHaveBeenCalled();
    expect(controller.active()).toBeNull();
  });

  it('stores a bank covering 27 and 33 and puts it last in the next session', async () => {
    const { controller, deps, backend, levels, measured } = setup();
    const bytes = buildSoundFont(CLEAN_AND_FINGERED);
    await controller.pick(file('Mine.sf2', bytes));

    const options = synthBankOptions(controller.active());
    expect(options.banks.slice(0, -1)).toEqual(bundledBankSources());
    const last = options.banks.at(-1)!;
    expect('bytes' in last && last.bytes).toBeInstanceOf(Uint8Array);
    // The filtered copy, not the original: its piano is moved off bank 0.
    expect('bytes' in last && last.bytes).not.toEqual(bytes);

    // Measured over the bundled banks plus the player's, for its covered programs only (R10).
    expect(measured).toEqual([{ banks: 2, programs: [27, 33] }]);
    expect(levels.at(-1)).toEqual([...bundledTables(), { 27: 0.05, 33: 0.05 }]);
    expect(deps.rebuild).toHaveBeenCalledTimes(1);

    const stored = backend.value as { fileName: string; bytes: Uint8Array; levels: LevelTable };
    expect(stored.fileName).toBe('Mine.sf2');
    expect(stored.bytes).toEqual(bytes);
    expect(stored.levels).toEqual({ 27: 0.05, 33: 0.05 });

    expect(controller.snapshot().view).toEqual({ kind: 'loaded', fileName: 'Mine.sf2', families: 'Clean electric, Fingered bass' });
    expect(controller.snapshot().notice?.text).toMatch(/Clean electric, Fingered bass/);
    expect(controller.snapshot().notice?.text).not.toMatch(/remembered/);
  });

  it('shows the processing state while it checks, and paints it before measuring', async () => {
    const { controller, deps } = setup();
    const seen: string[] = [];
    controller.subscribe(() => seen.push(controller.snapshot().view.kind));
    let framed = false;
    deps.nextFrame = async () => {
      framed = true;
    };
    const measure = deps.measure;
    deps.measure = (banks, programs) => {
      expect(framed).toBe(true);
      expect(controller.snapshot().view.kind).toBe('processing');
      return measure(banks, programs);
    };
    await controller.pick(file('Mine.sf2', buildSoundFont(CLEAN_AND_FINGERED)));
    expect(seen[0]).toBe('processing');
    expect(seen.at(-1)).toBe('loaded');
  });

  it('covers AE2: a palm-mute preset becomes the tone muted preset for the session', async () => {
    const { controller } = setup();
    await controller.pick(file('Metal.sf2', buildSoundFont(WITH_DIST_MUTE)));
    expect(synthBankOptions(controller.active()).mutedPresets).toEqual({ distortion: { bank: PLAYER_RESERVED_BANK, program: 30 } });
    expect(synthBankOptions(null).mutedPresets).toEqual({});
  });

  it('refuses a file over 512 MB before reading it', async () => {
    const { controller, deps, backend } = setup();
    const huge = { name: 'Huge.sf2', size: MAX_USER_BANK_BYTES + 1, arrayBuffer: vi.fn(async () => new ArrayBuffer(0)) };
    await controller.pick(huge);
    expect(huge.arrayBuffer).not.toHaveBeenCalled();
    expect(controller.snapshot().notice?.text).toMatch(/512 MB/);
    expect(backend.value).toBeNull();
    expect(deps.rebuild).not.toHaveBeenCalled();
  });

  it('without IndexedDB still plays the bank this session, and says it will not be remembered', async () => {
    const { controller, deps } = setup(indexedDbBackend(null));
    await controller.pick(file('Mine.sf2', buildSoundFont(CLEAN_AND_FINGERED)));
    expect(controller.active()?.fileName).toBe('Mine.sf2');
    expect(deps.rebuild).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().notice?.text).toMatch(/won.t be remembered/);
  });

  it('covers AE4: after a restart the bank is active again, and removing it brings back the bundled sounds', async () => {
    const backend = memoryBackend();
    const first = setup(backend);
    await first.controller.pick(file('Mine.sf2', buildSoundFont(CLEAN_AND_FINGERED)));

    const second = setup(backend);
    await second.controller.start();
    expect(second.controller.active()?.fileName).toBe('Mine.sf2');
    expect(synthBankOptions(second.controller.active()).banks).toHaveLength(bundledBankSources().length + 1);
    // Stored levels are used, not measured again.
    expect(second.measured).toEqual([]);
    expect(second.levels.at(-1)).toEqual([...bundledTables(), { 27: 0.05, 33: 0.05 }]);
    expect(second.controller.snapshot().view).toEqual({ kind: 'loaded', fileName: 'Mine.sf2', families: 'Clean electric, Fingered bass' });
    expect(second.controller.snapshot().notice).toBeNull();
    expect(second.deps.rebuild).toHaveBeenCalledTimes(1);

    await second.controller.remove();
    expect(backend.value).toBeNull();
    expect(second.controller.active()).toBeNull();
    expect(synthBankOptions(second.controller.active()).banks).toEqual(bundledBankSources());
    expect(second.levels.at(-1)).toEqual(bundledTables());
    expect(second.deps.rebuild).toHaveBeenCalledTimes(2);
    expect(second.controller.snapshot().view).toEqual({ kind: 'idle' });
  });

  it('skips a stored bank whose bytes are cut short, keeps it stored, and "Remove it" clears it', async () => {
    const backend = memoryBackend();
    await new UserBankStore(backend).save({
      fileName: 'Cut.sf2',
      bytes: buildSoundFont(CLEAN_AND_FINGERED).subarray(0, 60),
      report: { covered: [{ program: 27, name: 'Clean Gtr' }], rejected: [], mutedCandidates: [], disabled: [] },
      levels: { 27: 0.05 },
    });
    const { controller, deps, levels } = setup(backend);
    await controller.start();
    expect(controller.active()).toBeNull();
    expect(deps.rebuild).not.toHaveBeenCalled();
    expect(levels).toEqual([]);
    expect(backend.value).not.toBeNull();
    expect(controller.snapshot().view).toEqual({ kind: 'failed', fileName: 'Cut.sf2' });
    const notice = controller.snapshot().notice!;
    expect(notice.text).toMatch(/Cut\.sf2/);
    expect(notice.text).toMatch(/bundled/i);
    expect(notice.offerRemove).toBe(true);

    await controller.remove();
    expect(backend.value).toBeNull();
    expect(controller.snapshot().view).toEqual({ kind: 'idle' });
    expect(controller.snapshot().notice).toBeNull();
    expect(deps.rebuild).not.toHaveBeenCalled();
  });

  it('dismisses its notice', async () => {
    const { controller } = setup();
    await controller.pick(file('Pianos.sf2', buildSoundFont(PIANO_ONLY)));
    controller.dismiss();
    expect(controller.snapshot().notice).toBeNull();
  });
});

describe('keeping the playhead across a rebuild', () => {
  function fakeClock(time: number, playing: boolean) {
    const clock = {
      playing,
      at: time,
      time: () => clock.at,
      play: vi.fn(() => {
        clock.playing = true;
      }),
      pause: vi.fn(() => {
        clock.playing = false;
      }),
      seek: vi.fn((s: number) => {
        clock.at = s;
      }),
    };
    return clock;
  }

  it('loading a bank while playing pauses, and the rebuilt clock resumes from the same position', () => {
    const old = fakeClock(42.5, true);
    const place = holdPlace(old);
    expect(old.pause).toHaveBeenCalled();
    const rebuilt = fakeClock(0, false);
    place.restore(rebuilt);
    expect(rebuilt.seek).toHaveBeenCalledWith(42.5);
    expect(rebuilt.play).toHaveBeenCalledTimes(1);
  });

  it('a paused song stays paused at its position', () => {
    const place = holdPlace(fakeClock(10, false));
    const rebuilt = fakeClock(0, false);
    place.restore(rebuilt);
    expect(rebuilt.seek).toHaveBeenCalledWith(10);
    expect(rebuilt.play).not.toHaveBeenCalled();
  });

  it('with no clock, restores to the start without playing', () => {
    const rebuilt = fakeClock(5, false);
    holdPlace(undefined).restore(rebuilt);
    expect(rebuilt.seek).toHaveBeenCalledWith(0);
    expect(rebuilt.play).not.toHaveBeenCalled();
  });
});
