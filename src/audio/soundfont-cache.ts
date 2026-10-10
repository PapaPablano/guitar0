/** Name of the browser cache that holds the downloaded SoundFont. */
export const SOUNDFONT_CACHE = 'tab-highway-soundfont';

/** The slices of the browser's fetch and Cache Storage this module uses, so tests pass fakes. */
export interface SoundFontEnv {
  fetch: (url: string) => Promise<Response>;
  caches: CacheStorage | null;
}

export function defaultSoundFontEnv(): SoundFontEnv {
  let caches: CacheStorage | null = null;
  try {
    // Reading `caches` throws in some private windows and insecure contexts.
    caches = typeof globalThis.caches === 'undefined' ? null : globalThis.caches;
  } catch {
    caches = null;
  }
  return { fetch: (url) => fetch(url), caches };
}

/**
 * True when the bytes are a whole SoundFont: a RIFF `sfbk` container whose declared size matches what was received.
 * A download cut short, or a web page served in place of the file, fails this.
 */
export function isWholeSoundFont(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') return false;
  const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8;
  return declared === bytes.length;
}

function absolute(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).href;
  } catch {
    return url;
  }
}

async function readCached(env: SoundFontEnv, url: string): Promise<Uint8Array | null> {
  try {
    const cache = await env.caches?.open(SOUNDFONT_CACHE);
    const hit = await cache?.match(url);
    if (!hit) return null;
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (isWholeSoundFont(bytes)) return bytes;
    // A damaged entry is dropped so the next load fetches a fresh copy.
    await cache?.delete(url);
  } catch {
    // An unreadable cache is the same as an empty one.
  }
  return null;
}

async function writeCached(env: SoundFontEnv, url: string, bytes: Uint8Array): Promise<void> {
  try {
    const cache = await env.caches?.open(SOUNDFONT_CACHE);
    if (!cache) return;
    await cache.put(url, new Response(bytes as BodyInit));
    // The file name carries a content hash, so any other entry is an older build's font.
    const mine = absolute(url);
    for (const request of await cache.keys()) if (request.url !== mine) await cache.delete(request);
  } catch {
    // Not being able to keep a copy only costs a download next time.
  }
}

async function download(env: SoundFontEnv, url: string, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
  const response = await env.fetch(url);
  if (!response.ok) throw new Error(`The sound could not be downloaded (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || 0;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) onProgress?.(Math.min(1, received / total));
    }
  } else {
    const whole = new Uint8Array(await response.arrayBuffer());
    chunks.push(whole);
    received = whole.length;
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  if (!isWholeSoundFont(bytes)) throw new Error('The sound download was incomplete.');
  onProgress?.(1);
  return bytes;
}

/**
 * The SoundFont's bytes, from the browser's cache when a whole copy is there, otherwise downloaded (reporting 0..1)
 * and then kept for next time. Rejects when the download fails; the caller offers a retry.
 */
export async function loadSoundFontBytes(
  url: string,
  onProgress?: (fraction: number) => void,
  env: SoundFontEnv = defaultSoundFontEnv(),
): Promise<Uint8Array> {
  const cached = await readCached(env, url);
  if (cached) {
    onProgress?.(1);
    return cached;
  }
  const bytes = await download(env, url, onProgress);
  await writeCached(env, url, bytes);
  return bytes;
}
