import { describe, expect, it, vi } from 'vitest';
import { isWholeSoundFont, loadSoundFontBytes, SOUNDFONT_STALL_MS, type SoundFontEnv } from '../../src/audio/soundfont-cache';

const URL_A = 'https://example.test/assets/font-aaa.sf3';
const URL_B = 'https://example.test/assets/font-bbb.sf3';

/** A minimal RIFF `sfbk` container of the given total length. */
function font(total = 64): Uint8Array {
  const bytes = new Uint8Array(total);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  new DataView(bytes.buffer).setUint32(4, total - 8, true);
  bytes.set([0x73, 0x66, 0x62, 0x6b], 8);
  return bytes;
}

function responseOf(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes as BodyInit, { status, headers: { 'content-length': String(bytes.length) } });
}

function fakeCaches(initial: Record<string, Uint8Array> = {}, failOn?: 'open' | 'put') {
  const store = new Map<string, Uint8Array>(Object.entries(initial));
  const cache = {
    match: vi.fn(async (url: string) => (store.has(url) ? responseOf(store.get(url)!) : undefined)),
    put: vi.fn(async (url: string, response: Response) => {
      if (failOn === 'put') throw new Error('quota');
      store.set(url, new Uint8Array(await response.arrayBuffer()));
    }),
    delete: vi.fn(async (request: string | Request) => store.delete(typeof request === 'string' ? request : request.url)),
    keys: vi.fn(async () => [...store.keys()].map((url) => new Request(url))),
  };
  const caches = {
    open: vi.fn(async () => {
      if (failOn === 'open') throw new Error('blocked');
      return cache;
    }),
  } as unknown as CacheStorage;
  return { caches, cache, store };
}

function env(overrides: Partial<SoundFontEnv> = {}): SoundFontEnv {
  return { fetch: vi.fn(async () => responseOf(font())), caches: null, ...overrides };
}

describe('isWholeSoundFont', () => {
  it('accepts a RIFF sfbk file whose declared size matches', () => {
    expect(isWholeSoundFont(font(100))).toBe(true);
  });

  it('rejects a truncated file, an empty one and a web page', () => {
    expect(isWholeSoundFont(font(100).slice(0, 60))).toBe(false);
    expect(isWholeSoundFont(new Uint8Array(0))).toBe(false);
    expect(isWholeSoundFont(new TextEncoder().encode('<!doctype html><html></html>'))).toBe(false);
  });
});

describe('loadSoundFontBytes', () => {
  it('downloads on an empty cache, reports progress up to 1, and keeps a copy', async () => {
    const { caches, store } = fakeCaches();
    const progress: number[] = [];
    const bytes = await loadSoundFontBytes(URL_A, (f) => progress.push(f), env({ caches }));
    expect(isWholeSoundFont(bytes)).toBe(true);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toBeGreaterThanOrEqual(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(store.has(URL_A)).toBe(true);
  });

  it('uses the cached copy with no network request', async () => {
    const { caches } = fakeCaches({ [URL_A]: font(80) });
    const fetchSpy = vi.fn();
    const progress: number[] = [];
    const bytes = await loadSoundFontBytes(URL_A, (f) => progress.push(f), { fetch: fetchSpy, caches });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bytes.length).toBe(80);
    expect(progress).toEqual([1]);
  });

  it('rejects when the download fails, and a retry that succeeds recovers', async () => {
    const { caches } = fakeCaches();
    const fetchFn = vi
      .fn<SoundFontEnv['fetch']>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(responseOf(font()));
    await expect(loadSoundFontBytes(URL_A, undefined, { fetch: fetchFn, caches })).rejects.toThrow('network down');
    await expect(loadSoundFontBytes(URL_A, undefined, { fetch: fetchFn, caches })).resolves.toHaveLength(64);
  });

  it('rejects on a bad status and stores nothing', async () => {
    const { caches, store } = fakeCaches();
    const fetchFn = vi.fn(async () => responseOf(new Uint8Array(0), 404));
    await expect(loadSoundFontBytes(URL_A, undefined, { fetch: fetchFn, caches })).rejects.toThrow('404');
    expect(store.size).toBe(0);
  });

  it('rejects an incomplete download and does not cache it', async () => {
    const { caches, store } = fakeCaches();
    const fetchFn = vi.fn(async () => responseOf(font(100).slice(0, 50)));
    await expect(loadSoundFontBytes(URL_A, undefined, { fetch: fetchFn, caches })).rejects.toThrow('incomplete');
    expect(store.size).toBe(0);
  });

  it('discards a truncated cached entry and downloads again', async () => {
    const { caches, store } = fakeCaches({ [URL_A]: font(100).slice(0, 40) });
    const fetchFn = vi.fn(async () => responseOf(font(100)));
    const bytes = await loadSoundFontBytes(URL_A, undefined, { fetch: fetchFn, caches });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(bytes.length).toBe(100);
    expect(store.get(URL_A)!.length).toBe(100);
  });

  it('discards an empty cached entry', async () => {
    const { caches } = fakeCaches({ [URL_A]: new Uint8Array(0) });
    const fetchFn = vi.fn(async () => responseOf(font()));
    await loadSoundFontBytes(URL_A, undefined, { fetch: fetchFn, caches });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain download when Cache Storage is missing', async () => {
    await expect(loadSoundFontBytes(URL_A, undefined, env({ caches: null }))).resolves.toHaveLength(64);
  });

  it('falls back to a plain download when Cache Storage throws', async () => {
    for (const failOn of ['open', 'put'] as const) {
      const { caches } = fakeCaches({}, failOn);
      await expect(loadSoundFontBytes(URL_A, undefined, env({ caches }))).resolves.toHaveLength(64);
    }
  });

  it('removes an older build\'s font once the new one is stored', async () => {
    const { caches, store } = fakeCaches({ [URL_B]: font(90) });
    await loadSoundFontBytes(URL_A, undefined, env({ caches }));
    expect([...store.keys()]).toEqual([URL_A]);
  });

  it('gives up on a download that stops delivering, so a retry can be offered', async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async (_url: string, signal?: AbortSignal) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(font(64).slice(0, 10));
            signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(stream, { headers: { 'content-length': '64' } });
      });
      const result = loadSoundFontBytes(URL_A, undefined, { fetch: fetchFn, caches: null });
      const failure = expect(result).rejects.toThrow('stalled');
      await vi.advanceTimersByTimeAsync(SOUNDFONT_STALL_MS + 1000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });
});
