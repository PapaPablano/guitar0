import { describe, expect, it } from 'vitest';
import { initialMix } from '../../src/audio/mix-gains';
import { OFFSET_MAX_SECONDS } from '../../src/audio/offset-range';
import {
  FileProfileStore,
  PROFILE_CAP,
  PROFILE_VERSION,
  normalizeProfile,
  type ProfileFileBackend,
} from '../../src/audio/recording-profile';

function memoryBackend(initial: unknown = null): ProfileFileBackend & { data: unknown; writes: number } {
  const backend = {
    data: initial,
    writes: 0,
    async read() {
      return backend.data;
    },
    async write(file: unknown) {
      backend.writes += 1;
      backend.data = file;
    },
  };
  return backend;
}

describe('normalizeProfile', () => {
  it('keeps a valid offset and mix and carries no loop or tempo field', () => {
    const mix = initialMix();
    mix.drums.muted = true;
    const p = normalizeProfile({ version: PROFILE_VERSION, offset: 0.25, mix, loop: [1, 2], tempo: 0.5 });
    expect(p).toEqual({ version: PROFILE_VERSION, offset: 0.25, mix });
    expect(p).not.toHaveProperty('loop');
    expect(p).not.toHaveProperty('tempo');
  });

  it('clamps a stored offset outside the range on read (KTD10)', () => {
    expect(normalizeProfile({ version: PROFILE_VERSION, offset: 999 })?.offset).toBe(OFFSET_MAX_SECONDS);
    expect(normalizeProfile({ version: PROFILE_VERSION, offset: -999 })?.offset).toBe(-OFFSET_MAX_SECONDS);
  });

  it('rejects an unknown version, a non-numeric offset and non-objects', () => {
    expect(normalizeProfile({ version: 99, offset: 1 })).toBeNull();
    expect(normalizeProfile({ version: PROFILE_VERSION, offset: 'x' })).toBeNull();
    expect(normalizeProfile(null)).toBeNull();
    expect(normalizeProfile(5)).toBeNull();
  });

  it('drops a malformed mix but keeps the offset', () => {
    const p = normalizeProfile({ version: PROFILE_VERSION, offset: 1, mix: { vocals: 3 } });
    expect(p).toEqual({ version: PROFILE_VERSION, offset: 1 });
  });
});

describe('normalizeProfile and alignment', () => {
  it('ignores an alignment stored in the profile, since it lives in its own file', () => {
    const stored = { version: PROFILE_VERSION, offset: 1.5, alignment: { source: 'auto', holds: [{ at: 20, length: 16 }], anchors: [1, 2], endAnchor: 3 } };
    const p = normalizeProfile(stored);
    expect(p).toEqual({ version: PROFILE_VERSION, offset: 1.5 });
    expect(p).not.toHaveProperty('alignment');
  });

  it('keeps the offset and mix of a profile saved before the change', () => {
    const mix = initialMix();
    const p = normalizeProfile({ version: PROFILE_VERSION, offset: 2, mix, alignment: { source: 'manual', holds: [] } });
    expect(p).toEqual({ version: PROFILE_VERSION, offset: 2, mix });
  });
});

describe('FileProfileStore', () => {
  it('returns a saved offset and mix for the same hash and not for another', async () => {
    const store = new FileProfileStore(memoryBackend());
    const mix = initialMix();
    mix.vocals.volume = 0.5;
    await store.save('h1', { version: PROFILE_VERSION, offset: 0.5, mix });
    await expect(store.load('h1')).resolves.toEqual({ version: PROFILE_VERSION, offset: 0.5, mix });
    await expect(store.load('h2')).resolves.toBeNull();
  });

  it('evicts the oldest entry past the cap and keeps the newest', async () => {
    const store = new FileProfileStore(memoryBackend(), 3);
    for (const h of ['a', 'b', 'c', 'd']) await store.save(h, { version: PROFILE_VERSION, offset: 1 });
    await expect(store.load('a')).resolves.toBeNull();
    await expect(store.load('d')).resolves.not.toBeNull();
    await expect(store.load('b')).resolves.not.toBeNull();
  });

  it('re-saving a hash refreshes it so it is not the next evicted', async () => {
    const store = new FileProfileStore(memoryBackend(), 2);
    await store.save('a', { version: PROFILE_VERSION, offset: 1 });
    await store.save('b', { version: PROFILE_VERSION, offset: 1 });
    await store.save('a', { version: PROFILE_VERSION, offset: 2 });
    await store.save('c', { version: PROFILE_VERSION, offset: 1 });
    await expect(store.load('b')).resolves.toBeNull();
    await expect(store.load('a')).resolves.toMatchObject({ offset: 2 });
  });

  it('ignores a file with an unknown schema version and the next save replaces it', async () => {
    const backend = memoryBackend({ version: 99, entries: [{ hash: 'h1', profile: { version: 99, offset: 3 } }] });
    const store = new FileProfileStore(backend);
    await expect(store.load('h1')).resolves.toBeNull();
    await store.save('h2', { version: PROFILE_VERSION, offset: 1 });
    await expect(store.load('h2')).resolves.toMatchObject({ offset: 1 });
    expect((backend.data as { version: number }).version).toBe(PROFILE_VERSION);
  });

  it('drops an entry with an unknown profile version without losing the others', async () => {
    const backend = memoryBackend({
      version: PROFILE_VERSION,
      entries: [
        { hash: 'old', profile: { version: 99, offset: 3 } },
        { hash: 'ok', profile: { version: PROFILE_VERSION, offset: 1 } },
      ],
    });
    const store = new FileProfileStore(backend);
    await expect(store.load('old')).resolves.toBeNull();
    await expect(store.load('ok')).resolves.toMatchObject({ offset: 1 });
  });

  it('never throws when the backend fails to read or write (R20)', async () => {
    const failing: ProfileFileBackend = {
      read: async () => {
        throw new Error('boom');
      },
      write: async () => {
        throw new Error('boom');
      },
    };
    const store = new FileProfileStore(failing);
    await expect(store.load('h1')).resolves.toBeNull();
    await expect(store.save('h1', { version: PROFILE_VERSION, offset: 1 })).resolves.toBeUndefined();
  });

  it('has a sensible default cap', () => {
    expect(PROFILE_CAP).toBeGreaterThan(10);
  });
});

describe('saving profiles in quick succession', () => {
  it('saving recording A and then recording B in quick succession leaves both entries', async () => {
    const slow = memoryBackend(null);
    const read = slow.read.bind(slow);
    slow.read = async () => {
      const value = await read();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return value;
    };
    const store = new FileProfileStore(slow);
    await Promise.all([
      store.save('a', { version: PROFILE_VERSION, offset: 1 }),
      store.save('b', { version: PROFILE_VERSION, offset: 2 }),
      store.save('c', { version: PROFILE_VERSION, offset: 3 }),
    ]);
    await expect(store.load('a')).resolves.toMatchObject({ offset: 1 });
    await expect(store.load('b')).resolves.toMatchObject({ offset: 2 });
    await expect(store.load('c')).resolves.toMatchObject({ offset: 3 });
  });
});
