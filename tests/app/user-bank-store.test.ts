import { describe, expect, it } from 'vitest';
import { indexedDbBackend, USER_BANK_VERSION, UserBankStore, type UserBankBackend } from '../../src/app/user-bank-store';
import type { StoredUserBank } from '../../src/audio/user-bank';

/** An in-memory backend, so the store is tested without a browser database. */
function memoryBackend(initial: unknown = null): UserBankBackend & { value: unknown; fail: boolean } {
  const backend = {
    value: initial,
    fail: false,
    read: async () => {
      if (backend.fail) throw new Error('blocked');
      return backend.value;
    },
    write: async (value: unknown) => {
      if (backend.fail) throw new Error('blocked');
      backend.value = value;
    },
    remove: async () => {
      if (backend.fail) throw new Error('blocked');
      backend.value = null;
    },
  };
  return backend;
}

const bank: StoredUserBank = {
  fileName: 'My Guitars.sf2',
  bytes: Uint8Array.from([1, 2, 3, 4]),
  report: { covered: [{ program: 27, name: 'Clean Gtr' }], rejected: [], mutedCandidates: [], disabled: [] },
  levels: { 27: 0.05 },
};

describe("the player's sound bank store", () => {
  it('covers AE4: a saved bank reads back the same from a fresh store on the same backend', async () => {
    const backend = memoryBackend();
    await new UserBankStore(backend).save(bank);
    const loaded = await new UserBankStore(backend).load();
    expect(loaded).toEqual(bank);
    expect(loaded?.bytes).toBeInstanceOf(Uint8Array);
  });

  it('reads as nothing stored when the backend is empty, fails, or holds something it does not know', async () => {
    expect(await new UserBankStore(memoryBackend()).load()).toBeNull();
    const failing = memoryBackend();
    failing.fail = true;
    expect(await new UserBankStore(failing).load()).toBeNull();
    for (const raw of [
      'text',
      { ...bank, version: USER_BANK_VERSION + 1 },
      { ...bank, version: USER_BANK_VERSION, bytes: [1, 2, 3] },
      { ...bank, version: USER_BANK_VERSION, fileName: 7 },
      { ...bank, version: USER_BANK_VERSION, levels: null },
      { ...bank, version: USER_BANK_VERSION, report: { covered: 'all' } },
    ]) {
      expect(await new UserBankStore(memoryBackend(raw)).load(), JSON.stringify(raw)).toBeNull();
    }
  });

  it('clears back to nothing stored', async () => {
    const backend = memoryBackend();
    const store = new UserBankStore(backend);
    await store.save(bank);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('refuses to save when the browser has no IndexedDB, and reads nothing', async () => {
    const store = new UserBankStore(indexedDbBackend(null));
    await expect(store.save(bank)).rejects.toThrow();
    expect(await store.load()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
