import { describe, expect, it } from 'vitest';
import { hashFile } from '../../src/stems/file-hash';
import { SavedStems, type StemIndexStore } from '../../src/stems/saved-stems';

function memoryStore(initial: Record<string, string> = {}): StemIndexStore & { data: Record<string, string> } {
  const store = {
    data: { ...initial },
    async read() {
      return { ...store.data };
    },
    async write(next: Record<string, string>) {
      store.data = { ...next };
    },
  };
  return store;
}

describe('hashFile', () => {
  it('covers AE3: same bytes under a different name hash the same; different bytes do not', async () => {
    const a = new File([new Uint8Array([1, 2, 3])], 'a.mp3');
    const b = new File([new Uint8Array([1, 2, 3])], 'renamed.mp3');
    const c = new File([new Uint8Array([1, 2, 4])], 'a.mp3');
    expect(await hashFile(a)).toBe(await hashFile(b));
    expect(await hashFile(a)).not.toBe(await hashFile(c));
    expect(await hashFile(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('SavedStems', () => {
  it('returns the job for a recorded file whose job still exists', async () => {
    const saved = new SavedStems(memoryStore({ h1: 'job1' }));
    await expect(saved.find('h1', async () => true)).resolves.toBe('job1');
  });

  it('covers AE3: an unknown hash is not found', async () => {
    const saved = new SavedStems(memoryStore({ h1: 'job1' }));
    await expect(saved.find('h2', async () => true)).resolves.toBeNull();
  });

  it('treats an entry whose job is gone as not separated and removes it', async () => {
    const store = memoryStore({ h1: 'job1' });
    const saved = new SavedStems(store);
    await expect(saved.find('h1', async () => false)).resolves.toBeNull();
    expect(store.data).toEqual({});
  });

  it('records a finished job and keeps other entries', async () => {
    const store = memoryStore({ h1: 'job1' });
    await new SavedStems(store).record('h2', 'job2');
    expect(store.data).toEqual({ h1: 'job1', h2: 'job2' });
  });

  it('covers AE2: nothing is recorded unless record is called, so a cancelled run leaves no entry', async () => {
    const store = memoryStore();
    const saved = new SavedStems(store);
    await expect(saved.find('h1', async () => true)).resolves.toBeNull();
    expect(store.data).toEqual({});
  });
});

describe('SavedStems failure handling', () => {
  const failing = (): StemIndexStore => ({
    read: async () => {
      throw new Error('locked');
    },
    write: async () => {
      throw new Error('locked');
    },
  });

  it('treats an unreadable index as not saved instead of failing', async () => {
    await expect(new SavedStems(failing()).find('h', async () => true)).resolves.toBeNull();
  });

  it('treats an engine that cannot be asked as not saved', async () => {
    const saved = new SavedStems(memoryStore({ h: 'job' }));
    await expect(
      saved.find('h', async () => {
        throw new Error('engine down');
      }),
    ).resolves.toBeNull();
  });

  it('tryRecord reports failure without throwing and never overwrites an unreadable index', async () => {
    const writes: Record<string, string>[] = [];
    const store: StemIndexStore = {
      read: async () => {
        throw new Error('locked');
      },
      write: async (index) => {
        writes.push(index);
      },
    };
    await expect(new SavedStems(store).tryRecord('h', 'job')).resolves.toBe(false);
    expect(writes).toEqual([]);
  });

  it('tryRecord returns true when it saved', async () => {
    const store = memoryStore();
    await expect(new SavedStems(store).tryRecord('h', 'job')).resolves.toBe(true);
    expect(store.data).toEqual({ h: 'job' });
  });
});
