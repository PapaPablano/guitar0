import { describe, expect, it, vi } from 'vitest';
import type * as alphaTab from '@coderline/alphatab';
import { loadBanksThenScore, SynthClock, type BankSource } from '../../src/audio/synth-bridge';
import type { SoundFontEnv } from '../../src/audio/soundfont-cache';
import { BUNDLED_BANKS, bundledBankSources } from '../../src/audio/bank-manifest';

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

/** A minimal RIFF `sfbk` container of the given total length, with a marker byte to tell banks apart. */
function font(total: number, marker: number): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(bytes.buffer).setUint32(4, total - 8, true);
  bytes.set([0x73, 0x66, 0x62, 0x6b], 8);
  bytes[12] = marker;
  return bytes;
}

/** A response that delivers its bytes in two halves, waiting for `release` before the second. */
function slowResponse(bytes: Uint8Array, release: Promise<void>): Response {
  const half = Math.floor(bytes.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(bytes.slice(0, half));
      await release;
      controller.enqueue(bytes.slice(half));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-length': String(bytes.length) } });
}

const GENERAL = 'https://example.test/assets/general-aaa.sf3';
const GUITARS = 'https://example.test/assets/guitars-bbb.sf2';

/** The calls the bank loader makes, in order, on a fake alphaTab api that becomes ready once it has the score's MIDI. */
function fakeApi() {
  const ready = emitter<void>();
  const error = emitter<unknown>();
  const calls: string[] = [];
  const loads: { marker: number; append: boolean }[] = [];
  let midiIn = false;
  const api = {
    playerReady: ready,
    error,
    loadSoundFont: vi.fn((data: Uint8Array, append: boolean) => {
      calls.push(`load:${data[12]}:${append}`);
      loads.push({ marker: data[12], append });
      // alphaTab 1.8.4 fires ready again on every bank that arrives after the MIDI.
      if (midiIn) ready.emit();
      return true;
    }),
    renderScore: vi.fn(() => {
      calls.push('render');
      midiIn = true;
      ready.emit();
    }),
  };
  return { api: api as unknown as alphaTab.AlphaTabApi, raw: api, calls, loads, ready, error };
}

function envWith(responses: Record<string, () => Response | Promise<Response>>): SoundFontEnv {
  return {
    fetch: vi.fn(async (url: string) => {
      const make = responses[url];
      if (!make) throw new TypeError(`no such file ${url}`);
      return make();
    }),
    caches: null,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadBanksThenScore', () => {
  it('posts every bank in list order, first replacing then appending, all before the score', async () => {
    const { api, calls } = fakeApi();
    const sources: BankSource[] = [{ url: GENERAL }, { url: GUITARS }, { bytes: font(40, 3) }];
    const env = envWith({ [GENERAL]: () => new Response(font(64, 1) as BodyInit), [GUITARS]: () => new Response(font(48, 2) as BodyInit) });
    await loadBanksThenScore(api, {} as alphaTab.model.Score, sources, { env });
    expect(calls).toEqual(['load:1:false', 'load:2:true', 'load:3:true', 'render']);
  });

  it('is ready only once the last bank is in, not when MuseScore General alone has arrived', async () => {
    const { api, calls } = fakeApi();
    let releaseGuitars!: () => void;
    const guitarsArrive = new Promise<void>((r) => (releaseGuitars = r));
    const env = envWith({
      [GENERAL]: () => new Response(font(64, 1) as BodyInit),
      [GUITARS]: () => slowResponse(font(48, 2), guitarsArrive),
    });
    let settled = false;
    const ready = loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }, { url: GUITARS }], { env }).then(() => (settled = true));
    await flush();
    await flush();
    expect(settled).toBe(false);
    expect(calls).toEqual([]);
    releaseGuitars();
    await ready;
    expect(calls).toEqual(['load:1:false', 'load:2:true', 'render']);
  });

  it('does not count a ready event that fires before the score is handed over', async () => {
    const { api, raw, ready } = fakeApi();
    raw.loadSoundFont.mockImplementation(() => {
      ready.emit();
      return true;
    });
    raw.renderScore.mockImplementation(() => undefined);
    const env = envWith({ [GENERAL]: () => new Response(font(64, 1) as BodyInit), [GUITARS]: () => new Response(font(48, 2) as BodyInit) });
    let settled = false;
    void loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }, { url: GUITARS }], { env }).then(() => (settled = true));
    for (let i = 0; i < 5; i++) await flush();
    expect(raw.renderScore).toHaveBeenCalled();
    expect(settled).toBe(false);
  });

  it('rejects when a later bank fails to download, and loads nothing', async () => {
    const { api, calls } = fakeApi();
    const env = envWith({ [GENERAL]: () => new Response(font(64, 1) as BodyInit), [GUITARS]: () => new Response(new Uint8Array(0) as BodyInit, { status: 404 }) });
    await expect(loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }, { url: GUITARS }], { env })).rejects.toThrow('404');
    expect(calls).toEqual([]);
  });

  it('rejects when the player refuses a bank', async () => {
    const { api, raw } = fakeApi();
    raw.loadSoundFont.mockImplementation(() => false);
    const env = envWith({ [GENERAL]: () => new Response(font(64, 1) as BodyInit) });
    await expect(loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }], { env })).rejects.toThrow('could not start');
    expect(raw.renderScore).not.toHaveBeenCalled();
  });

  it('rejects on an alphaTab error, such as a bank it cannot read', async () => {
    const { api, raw, error } = fakeApi();
    raw.renderScore.mockImplementation(() => error.emit(new Error('not a valid Soundfont2 file')));
    const env = envWith({ [GENERAL]: () => new Response(font(64, 1) as BodyInit) });
    await expect(loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }], { env })).rejects.toThrow('not a valid');
  });

  it('posts nothing when the session is closed while the banks download', async () => {
    const { api, calls } = fakeApi();
    let closed = false;
    const env = envWith({ [GENERAL]: () => new Response(font(64, 1) as BodyInit) });
    const ready = loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }], { env, isDisposed: () => closed });
    closed = true;
    void ready.catch(() => undefined);
    for (let i = 0; i < 5; i++) await flush();
    expect(calls).toEqual([]);
  });

  it('weights progress by size and reaches 100% only when every downloaded bank is in', async () => {
    const { api } = fakeApi();
    let releaseGeneral!: () => void;
    let releaseGuitars!: () => void;
    const generalArrives = new Promise<void>((r) => (releaseGeneral = r));
    const guitarsArrive = new Promise<void>((r) => (releaseGuitars = r));
    const env = envWith({
      [GENERAL]: () => slowResponse(font(300, 1), generalArrives),
      [GUITARS]: () => slowResponse(font(100, 2), guitarsArrive),
    });
    const progress: number[] = [];
    const ready = loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }, { url: GUITARS }, { bytes: font(40, 3) }], {
      env,
      onProgress: (f) => progress.push(f),
    });
    for (let i = 0; i < 5; i++) await flush();
    releaseGeneral();
    for (let i = 0; i < 5; i++) await flush();
    // The big bank is whole and the small one half there: 350 of 400 bytes.
    expect(progress.at(-1)).toBeCloseTo(350 / 400, 5);
    expect(progress).not.toContain(1);
    releaseGuitars();
    await ready;
    expect(progress.at(-1)).toBe(1);
    expect(progress.filter((f) => f === 1)).toHaveLength(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('keeps every bundled bank in the cache while loading them', async () => {
    const store = new Map<string, Uint8Array>();
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async (url: string, response: Response) => void store.set(url, new Uint8Array(await response.arrayBuffer()))),
      delete: vi.fn(async (request: string | Request) => store.delete(typeof request === 'string' ? request : request.url)),
      keys: vi.fn(async () => [...store.keys()].map((url) => new Request(url))),
    };
    const env: SoundFontEnv = {
      ...envWith({ [GENERAL]: () => new Response(font(64, 1) as BodyInit), [GUITARS]: () => new Response(font(48, 2) as BodyInit) }),
      caches: { open: vi.fn(async () => cache) } as unknown as CacheStorage,
    };
    const { api } = fakeApi();
    await loadBanksThenScore(api, {} as alphaTab.model.Score, [{ url: GENERAL }, { url: GUITARS }], { env, keep: [GENERAL, GUITARS] });
    expect([...store.keys()].sort()).toEqual([GENERAL, GUITARS]);
  });
});

describe('bank manifest', () => {
  it('starts with MuseScore General alone, so the sound is unchanged', () => {
    expect(BUNDLED_BANKS).toHaveLength(1);
    expect(BUNDLED_BANKS[0].url).toMatch(/MuseScore_General.*\.sf3/);
    expect(bundledBankSources()).toEqual([{ url: BUNDLED_BANKS[0].url }]);
  });
});

describe('SynthClock before the score is handed to alphaTab', () => {
  function pendingClock() {
    const tracks = [
      { index: 0, playbackInfo: { program: 30 }, staves: [] },
      { index: 1, playbackInfo: { program: 33 }, staves: [] },
    ];
    const api = {
      playerPositionChanged: emitter(),
      playerStateChanged: emitter(),
      playerReady: emitter(),
      score: null as unknown,
      loadMidiForScore: vi.fn(),
      changeTrackMute: vi.fn(),
    };
    const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, [{ tick: 0, tempo: 120 }], 0);
    clock.awaitScore({ tracks } as unknown as alphaTab.model.Score);
    return { api, clock, tracks };
  }

  it('applies a tone to the score without asking alphaTab to rebuild a score it does not have yet', () => {
    const { api, clock, tracks } = pendingClock();
    clock.setTrackPrograms(new Map([[0, 29]]));
    expect(tracks[0].playbackInfo.program).toBe(29);
    expect(api.loadMidiForScore).not.toHaveBeenCalled();
  });

  it('remembers the silenced track and applies it once the synth is ready', () => {
    const { api, clock, tracks } = pendingClock();
    clock.setSilentTrack(1);
    api.score = { tracks };
    api.playerReady.emit(undefined);
    expect(api.changeTrackMute).toHaveBeenLastCalledWith([tracks[1]], true);
  });
});
