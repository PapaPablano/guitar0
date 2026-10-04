import { describe, expect, it } from 'vitest';
import { PROFILE_VERSION } from '../../src/audio/recording-profile';
import { PROFILE_STORAGE_KEY, WebProfileStore } from '../../src/audio/profile-store-web';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe('WebProfileStore', () => {
  it('round-trips a profile by hash and returns null for another hash', async () => {
    const store = new WebProfileStore(fakeStorage());
    await store.save('h1', { version: PROFILE_VERSION, offset: -0.4 });
    await expect(store.load('h1')).resolves.toEqual({ version: PROFILE_VERSION, offset: -0.4 });
    await expect(store.load('h2')).resolves.toBeNull();
  });

  it('evicts the oldest entry past the cap', async () => {
    const store = new WebProfileStore(fakeStorage(), 2);
    for (const h of ['a', 'b', 'c']) await store.save(h, { version: PROFILE_VERSION, offset: 1 });
    await expect(store.load('a')).resolves.toBeNull();
    await expect(store.load('c')).resolves.not.toBeNull();
  });

  it('treats corrupt JSON and an unknown file version as no profile, and the next save replaces it', async () => {
    const corrupt = fakeStorage({ [PROFILE_STORAGE_KEY]: '{not json' });
    const store = new WebProfileStore(corrupt);
    await expect(store.load('h1')).resolves.toBeNull();
    await store.save('h1', { version: PROFILE_VERSION, offset: 2 });
    await expect(store.load('h1')).resolves.toMatchObject({ offset: 2 });

    const future = fakeStorage({ [PROFILE_STORAGE_KEY]: JSON.stringify({ version: 99, entries: [] }) });
    const store2 = new WebProfileStore(future);
    await expect(store2.load('h1')).resolves.toBeNull();
    await store2.save('h1', { version: PROFILE_VERSION, offset: 1 });
    expect(JSON.parse(future.data[PROFILE_STORAGE_KEY]).version).toBe(PROFILE_VERSION);
  });

  it('never throws when storage throws on read or write (R20)', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = new WebProfileStore(throwing);
    await expect(store.load('h1')).resolves.toBeNull();
    await expect(store.save('h1', { version: PROFILE_VERSION, offset: 1 })).resolves.toBeUndefined();
  });

  it('is safe when no storage exists at all', async () => {
    const store = new WebProfileStore(null);
    await expect(store.load('h1')).resolves.toBeNull();
    await expect(store.save('h1', { version: PROFILE_VERSION, offset: 1 })).resolves.toBeUndefined();
  });

  it('clamps an out-of-range stored offset on read', async () => {
    const storage = fakeStorage({
      [PROFILE_STORAGE_KEY]: JSON.stringify({
        version: PROFILE_VERSION,
        entries: [{ hash: 'h', profile: { version: PROFILE_VERSION, offset: 500 } }],
      }),
    });
    const p = await new WebProfileStore(storage).load('h');
    expect(p?.offset).toBe(30);
  });
});
