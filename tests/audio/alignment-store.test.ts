import { describe, expect, it } from 'vitest';
import type { AlignmentFile } from '../../src/audio/alignment-file';
import { FileAlignmentStore, type AlignmentFileBackend } from '../../src/audio/alignment-store';
import { ALIGNMENT_STORAGE_PREFIX, WebAlignmentStore } from '../../src/audio/alignment-store-web';
import type { ProfileStorage } from '../../src/audio/profile-store-web';
import type { AlignmentRecord } from '../../src/audio/recording-profile';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const record = (extra: Partial<AlignmentRecord> = {}): AlignmentRecord => ({ source: 'auto', holds: [], anchors: [1.5, 3.5], endAnchor: 5.5, ...extra });

function memoryBackend(): AlignmentFileBackend & { files: Map<string, unknown>; writes: AlignmentFile[] } {
  const backend = {
    files: new Map<string, unknown>(),
    writes: [] as AlignmentFile[],
    async read(hash: string) {
      return backend.files.get(hash) ?? null;
    },
    async write(hash: string, file: AlignmentFile) {
      backend.writes.push(file);
      backend.files.set(hash, file);
    },
  };
  return backend;
}

describe('FileAlignmentStore', () => {
  it('returns a saved record for the same recording and not for another', async () => {
    const store = new FileAlignmentStore(memoryBackend());
    await store.save(A, record());
    await expect(store.load(A)).resolves.toEqual(record());
    await expect(store.load(B)).resolves.toBeNull();
  });

  it('two saves in quick succession for one recording leave the second', async () => {
    const backend = memoryBackend();
    const slow = backend.write.bind(backend);
    let first = true;
    backend.write = async (hash, file) => {
      if (first) {
        first = false;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return slow(hash, file);
    };
    const store = new FileAlignmentStore(backend);
    await Promise.all([store.save(A, record({ anchors: [1, 2] })), store.save(A, record({ anchors: [7, 8] }))]);
    await expect(store.load(A)).resolves.toMatchObject({ anchors: [7, 8] });
  });

  it('a file for another recording, or one that is not an alignment, reads as none', async () => {
    const backend = memoryBackend();
    backend.files.set(A, { version: 1, recording: B, source: 'auto', holds: [] });
    backend.files.set(B, 'junk');
    const store = new FileAlignmentStore(backend);
    await expect(store.load(A)).resolves.toBeNull();
    await expect(store.load(B)).resolves.toBeNull();
  });

  it('never throws when the backend fails to read or write', async () => {
    const failing: AlignmentFileBackend = {
      read: async () => {
        throw new Error('boom');
      },
      write: async () => {
        throw new Error('boom');
      },
    };
    const store = new FileAlignmentStore(failing);
    await expect(store.load(A)).resolves.toBeNull();
    await expect(store.save(A, record())).resolves.toBeUndefined();
  });

  it('a failed save does not stop the next one for the same recording', async () => {
    const backend = memoryBackend();
    const write = backend.write.bind(backend);
    let calls = 0;
    backend.write = async (hash, file) => {
      calls += 1;
      if (calls === 1) throw new Error('locked');
      return write(hash, file);
    };
    const store = new FileAlignmentStore(backend);
    await store.save(A, record({ anchors: [1, 2] }));
    await store.save(A, record({ anchors: [3, 4] }));
    await expect(store.load(A)).resolves.toMatchObject({ anchors: [3, 4] });
  });
});

function fakeStorage(initial: Record<string, string> = {}): ProfileStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('WebAlignmentStore', () => {
  it('keeps one value per recording in browser storage and reads it back', async () => {
    const storage = fakeStorage();
    const store = new WebAlignmentStore(storage);
    await store.save(A, record());
    await store.save(B, record({ anchors: [9, 10] }));
    expect(Object.keys(storage.data).sort()).toEqual([ALIGNMENT_STORAGE_PREFIX + A, ALIGNMENT_STORAGE_PREFIX + B]);
    await expect(store.load(A)).resolves.toEqual(record());
    await expect(store.load(B)).resolves.toMatchObject({ anchors: [9, 10] });
  });

  it('an unreadable stored value reads as none and the next save replaces it', async () => {
    const storage = fakeStorage({ [ALIGNMENT_STORAGE_PREFIX + A]: '{not json' });
    const store = new WebAlignmentStore(storage);
    await expect(store.load(A)).resolves.toBeNull();
    await store.save(A, record());
    await expect(store.load(A)).resolves.toEqual(record());
  });

  it('unavailable storage makes load null and save a no-op that never throws', async () => {
    const store = new WebAlignmentStore(null);
    await expect(store.load(A)).resolves.toBeNull();
    await expect(store.save(A, record())).resolves.toBeUndefined();
  });

  it('storage that throws on read or write never throws out of the store', async () => {
    const hostile: ProfileStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const store = new WebAlignmentStore(hostile);
    await expect(store.load(A)).resolves.toBeNull();
    await expect(store.save(A, record())).resolves.toBeUndefined();
  });
});
