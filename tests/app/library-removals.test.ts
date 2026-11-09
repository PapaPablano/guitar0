import { afterEach, describe, expect, it, vi } from 'vitest';
import { SongLibrary, type LibraryBackend, type LibraryEntry, type LibraryIndex } from '../../src/app/library';
import { createLibrarySession } from '../../src/app/library-session';
import { deleteFile, hashBytes, saveRecording, saveTab, type LibraryShell } from '../../src/app/library-shell';
import {
  createDeleteGuard,
  createRemovalCommit,
  createRemovals,
  guardedStore,
  REMOVAL_UNDO_MS,
} from '../../src/app/library-removals';
import { hashFile } from '../../src/stems/file-hash';
import { FILE_TUNING } from '../../src/model/retune';

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets every queued promise step run. */
async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);

function entry(tabHash: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    tabHash,
    title: `Song ${tabHash[0]}`,
    fileName: `${tabHash[0]}.gp`,
    fingerprint: `fp-${tabHash[0]}`,
    openedAt: 1,
    recording: null,
    video: null,
    source: null,
    trackIndex: 0,
    tuningId: FILE_TUNING,
    ...extra,
  };
}

function memoryBackend(entries: unknown[] = []): LibraryBackend & { data: LibraryIndex; writes: number } {
  const backend = {
    data: { version: 1, entries } as LibraryIndex,
    writes: 0,
    async read() {
      return { index: JSON.parse(JSON.stringify(backend.data)) as LibraryIndex, quarantined: false };
    },
    async write(index: LibraryIndex) {
      backend.writes += 1;
      backend.data = JSON.parse(JSON.stringify(index)) as LibraryIndex;
    },
  };
  return backend;
}

/** A shell keeping files in memory; a delete is refused while a write to the same file is open, as library.rs does. */
function memoryShell() {
  const stored = new Map<string, Uint8Array>();
  const open = new Map<number, { key: string; parts: Uint8Array[] }>();
  const deletes: string[] = [];
  let next = 1;
  const key = (kind: string, hash: string, extension: string) => `${kind}/${hash}.${extension}`;
  const gates = { exists: null as Promise<void> | null, delete: null as Promise<void> | null, existsCalled: deferred() };
  const shell: LibraryShell = {
    async begin(kind, hash, extension) {
      const id = next++;
      open.set(id, { key: key(kind, hash, extension), parts: [] });
      return id;
    },
    async append(id, bytes) {
      open.get(id)!.parts.push(bytes.slice());
    },
    async finish(id) {
      const write = open.get(id)!;
      open.delete(id);
      const fresh = !stored.has(write.key);
      stored.set(write.key, new Uint8Array(await new Blob(write.parts as BlobPart[]).arrayBuffer()));
      return fresh;
    },
    async cancel(id) {
      open.delete(id);
    },
    async read() {
      throw new Error('not used');
    },
    async exists(kind, hash, extension) {
      gates.existsCalled.resolve();
      if (gates.exists) await gates.exists;
      return stored.has(key(kind, hash, extension));
    },
    async delete(kind, hash, extension) {
      if (gates.delete) await gates.delete;
      const k = key(kind, hash, extension);
      if ([...open.values()].some((w) => w.key === k)) return false;
      deletes.push(k);
      stored.delete(k);
      return true;
    },
  };
  const put = (kind: string, hash: string, extension: string) => stored.set(key(kind, hash, extension), new Uint8Array([1]));
  const has = (kind: string, hash: string, extension: string) => stored.has(key(kind, hash, extension));
  return { shell, stored, open, deletes, gates, put, has, key };
}

const recFile = () => new File([new Uint8Array([7, 7, 7])], 'take.mp3', { type: 'audio/mpeg' });

/** The page's library wiring as App builds it: a real SongLibrary, session, delete guard, commit and pending list. */
async function world(entries: LibraryEntry[], options: { settledAll?: () => Promise<void> } = {}) {
  const backend = memoryBackend(entries);
  const library = new SongLibrary(backend);
  const files = memoryShell();
  const deleting = createDeleteGuard();
  const session = createLibrarySession({
    library,
    files: {
      saveTab: (bytes, storing) => saveTab(files.shell, bytes, guardedStore(deleting, storing)),
      saveRecording: (file, storing) => saveRecording(files.shell, file, guardedStore(deleting, storing)),
    },
    now: () => 5,
    onNote: () => undefined,
  });
  const commit = createRemovalCommit({
    settledAll: options.settledAll ?? (() => session.settledAll()),
    commitRemoval: (tabHash, context) => library.commitRemoval(tabHash, context),
    storingHashes: session.storingHashes,
    deleting,
    deleteFile: (kind, hash, extension) => deleteFile(files.shell, kind, hash, extension),
  });
  const commitSpy = vi.fn(commit);
  const removals = createRemovals({ commit: commitSpy, dropEntries: (pending) => library.removeEntries(pending) });
  for (const e of entries) {
    files.put('tab', e.tabHash, 'bin');
    if (e.recording) files.put('recording', e.recording.hash, e.recording.extension);
  }
  return { backend, library, files, deleting, session, commit, commitSpy, removals };
}

const tabHashes = (backend: { data: LibraryIndex }) => backend.data.entries.map((e) => (e as LibraryEntry).tabHash);

describe('createRemovals', () => {
  function bare() {
    const commit = vi.fn((_tabHash: string, _pending: ReadonlySet<string>) => Promise.resolve());
    const dropEntries = vi.fn((_pending: ReadonlySet<string>) => Promise.resolve());
    const removals = createRemovals({ commit, dropEntries });
    return { commit, dropEntries, removals };
  }

  it('hides the song at once and commits it about 8 s later (R2, R4)', async () => {
    vi.useFakeTimers();
    const { commit, removals } = bare();
    removals.remove(entry(hashA));
    expect(removals.pendingHashes().has(hashA)).toBe(true);
    expect(removals.items().map((i) => i.tabHash)).toEqual([hashA]);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).toHaveBeenCalledWith(hashA, removals.pendingHashes());
    await flush();
    expect(removals.pendingHashes().size).toBe(0);
    expect(removals.items()).toEqual([]);
  });

  it('gives each removal its own timer (R2)', async () => {
    vi.useFakeTimers();
    const { commit, removals } = bare();
    removals.remove(entry(hashA));
    await vi.advanceTimersByTimeAsync(3000);
    removals.remove(entry(hashB));
    expect(removals.items().map((i) => i.tabHash)).toEqual([hashB, hashA]);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS - 3000);
    expect(commit.mock.calls.map((c) => c[0])).toEqual([hashA]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(commit.mock.calls.map((c) => c[0])).toEqual([hashA, hashB]);
  });

  it('undo drops the removal, so nothing commits (R3)', async () => {
    vi.useFakeTimers();
    const { commit, removals } = bare();
    removals.remove(entry(hashA));
    expect(removals.undo(hashA)).toBe(true);
    expect(removals.pendingHashes().has(hashA)).toBe(false);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS * 2);
    expect(commit).not.toHaveBeenCalled();
    expect(removals.undo(hashA)).toBe(false);
  });

  it('a pause holds the timer and a resume runs out only the time left', async () => {
    vi.useFakeTimers();
    const { commit, removals } = bare();
    removals.remove(entry(hashA));
    await vi.advanceTimersByTimeAsync(5000);
    removals.pause(hashA);
    expect(removals.items()[0].paused).toBe(true);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS * 2);
    expect(commit).not.toHaveBeenCalled();
    removals.resume(hashA);
    expect(removals.items()[0].paused).toBe(false);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS - 5000 - 1);
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commitAll commits everything pending at once and resolves when they have (R7)', async () => {
    vi.useFakeTimers();
    const finish = deferred();
    const commit = vi.fn((_tabHash: string, _pending: ReadonlySet<string>) => finish.promise);
    const removals = createRemovals({ commit, dropEntries: () => Promise.resolve() });
    removals.remove(entry(hashA));
    removals.remove(entry(hashB));
    let done = false;
    const all = removals.commitAll().then(() => void (done = true));
    await flush();
    expect(commit.mock.calls.map((c) => c[0]).sort()).toEqual([hashA, hashB]);
    expect(removals.items()).toEqual([]);
    expect(done).toBe(false);
    finish.resolve();
    await all;
    expect(removals.pendingHashes().size).toBe(0);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS * 2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('commitAll with nothing pending resolves at once', async () => {
    const { commit, removals } = bare();
    await removals.commitAll();
    expect(commit).not.toHaveBeenCalled();
  });

  it('dropEntriesAll stops every timer and drops the pending entries without committing them (close)', async () => {
    vi.useFakeTimers();
    const { commit, dropEntries, removals } = bare();
    removals.remove(entry(hashA));
    removals.remove(entry(hashB));
    await removals.dropEntriesAll();
    expect(dropEntries).toHaveBeenCalledTimes(1);
    expect([...dropEntries.mock.calls[0][0]].sort()).toEqual([hashA, hashB]);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS * 2);
    expect(commit).not.toHaveBeenCalled();
  });

  it('tells subscribers about every change, and stops after unsubscribing', async () => {
    vi.useFakeTimers();
    const { removals } = bare();
    const seen = vi.fn();
    const off = removals.subscribe(seen);
    removals.remove(entry(hashA));
    expect(seen).toHaveBeenCalledTimes(1);
    removals.undo(hashA);
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    removals.remove(entry(hashA));
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('ignores a second removal of a song already pending', () => {
    const { removals } = bare();
    removals.remove(entry(hashA));
    removals.remove(entry(hashA));
    expect(removals.items()).toHaveLength(1);
  });
});

describe('removal commits against the library', () => {
  const rec = (hash: string) => ({ hash, name: 'take.mp3', type: 'audio/mpeg', extension: 'mp3' });

  it('remove then undo leaves the index and every file as they were (R3)', async () => {
    vi.useFakeTimers();
    const { backend, files, removals } = await world([entry(hashA, { recording: rec('c'.repeat(64)) })]);
    removals.remove(entry(hashA));
    removals.undo(hashA);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS * 2);
    expect(backend.writes).toBe(0);
    expect(files.deletes).toEqual([]);
  });

  it('expiry removes the entry and deletes its tab and recording (R4)', async () => {
    vi.useFakeTimers();
    const r = 'c'.repeat(64);
    const { backend, files, removals } = await world([entry(hashA, { recording: rec(r) }), entry(hashB)]);
    removals.remove(entry(hashA, { recording: rec(r) }));
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS);
    await flush();
    expect(tabHashes(backend)).toEqual([hashB]);
    expect(files.deletes.sort()).toEqual([`recording/${r}.mp3`, `tab/${hashA}.bin`]);
  });

  it('a shared recording stays until the last song using it is removed (AE2)', async () => {
    vi.useFakeTimers();
    const r = 'c'.repeat(64);
    const a = entry(hashA, { recording: rec(r) });
    const b = entry(hashB, { recording: rec(r) });
    const { backend, files, removals } = await world([a, b]);
    removals.remove(a);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS);
    await flush();
    expect(files.has('recording', r, 'mp3')).toBe(true);
    removals.remove(b);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS);
    await flush();
    expect(tabHashes(backend)).toEqual([]);
    expect(files.has('recording', r, 'mp3')).toBe(false);
    expect(files.has('tab', hashA, 'bin')).toBe(false);
    expect(files.has('tab', hashB, 'bin')).toBe(false);
  });

  it('a recording another pending removal still names is kept (R4)', async () => {
    const r = 'c'.repeat(64);
    const a = entry(hashA, { recording: rec(r) });
    const b = entry(hashB, { recording: rec(r) });
    const { files, removals } = await world([a, b]);
    removals.remove(a);
    removals.remove(b);
    await removals.commitAll();
    // Whichever commits second sees no other entry naming R and deletes it; the first one kept it.
    expect(files.has('recording', r, 'mp3')).toBe(false);
    expect(files.deletes.filter((d) => d.startsWith('recording/'))).toHaveLength(1);
  });

  it('a cancel on reopen commits nothing (AE3, R6)', async () => {
    vi.useFakeTimers();
    const { backend, files, removals } = await world([entry(hashA)]);
    removals.remove(entry(hashA));
    await vi.advanceTimersByTimeAsync(2000);
    expect(removals.cancel(hashA)).toBe(true);
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS * 2);
    expect(backend.writes).toBe(0);
    expect(files.deletes).toEqual([]);
  });

  it('a cancel after the expiry fired but before the serial step leaves the entry untouched (R6)', async () => {
    vi.useFakeTimers();
    const saves = deferred();
    const { backend, files, removals, commitSpy } = await world([entry(hashA)], { settledAll: () => saves.promise });
    removals.remove(entry(hashA));
    await vi.advanceTimersByTimeAsync(REMOVAL_UNDO_MS);
    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(removals.cancel(hashA)).toBe(true);
    saves.resolve();
    await flush();
    expect(await commitSpy.mock.results[0].value).toBeNull();
    expect(backend.writes).toBe(0);
    expect(tabHashes(backend)).toEqual([hashA]);
    expect(files.deletes).toEqual([]);
  });

  it('waits for every in-flight save before its serial step (KTD3)', async () => {
    const { session, commit, backend, files } = await world([entry(hashA)]);
    let release!: () => void;
    files.gates.exists = new Promise<void>((resolve) => (release = resolve));
    // A save for another song that has not landed yet.
    void session.openTab(new Uint8Array([9]), { title: 'X', fileName: 'x.gp', fingerprint: 'fp' });
    let committed = false;
    const done = commit(hashA, new Set([hashA])).then(() => void (committed = true));
    await flush();
    expect(committed).toBe(false);
    expect(backend.writes).toBe(0);
    release();
    await done;
    const x = await hashBytes(new Uint8Array([9]));
    expect(tabHashes(backend)).toEqual([x]);
  });

  it('keeps a recording whose copy is being written: the shell refuses and the page counts it kept (R13)', async () => {
    const r = 'c'.repeat(64);
    const { files, commit } = await world([entry(hashA, { recording: rec(r) })]);
    // A write to the same file is open in the shell (one the page's storing set does not cover).
    const id = await files.shell.begin('recording', r, 'mp3');
    const outcome = await commit(hashA, new Set([hashA]));
    expect(outcome?.recording).toBe('in-use');
    expect(outcome?.tab).toBe('deleted');
    expect(files.has('recording', r, 'mp3')).toBe(true);
    await files.shell.cancel(id);
  });

  it('skips deleting a recording that is in the storing set (KTD3)', async () => {
    const file = recFile();
    const r = await hashFile(file);
    const { files, session, commit } = await world([entry(hashA, { recording: rec(r) })], { settledAll: () => Promise.resolve() });
    await session.openTab(new Uint8Array([2]), { title: 'B', fileName: 'b.gp', fingerprint: 'fp-b' });
    // B's copy of R is held in the exists check, with R in the storing set.
    files.gates.exists = new Promise(() => undefined);
    void session.recordingLoaded(file);
    await flush();
    expect(session.storingHashes.has(r)).toBe(true);
    const outcome = await commit(hashA, new Set([hashA]));
    expect(outcome?.recording).toBe('kept');
    expect(outcome?.tab).toBe('deleted');
    expect(files.has('recording', r, 'mp3')).toBe(true);
  });

  it('B loads R through the exists shortcut while A’s removal of R commits: R survives and B names it (R13)', async () => {
    const file = recFile();
    const r = await hashFile(file);
    const a = entry(hashA, { recording: rec(r) });
    const b = entry(hashB);
    const saves = deferred();
    const { files, session, library, commit } = await world([a, b], { settledAll: () => saves.promise });
    // B is open (its tab is already stored, so its save takes the exists shortcut).
    await session.openTab(new Uint8Array([2]), { title: 'B', fileName: 'b.gp', fingerprint: 'fp-b' });
    // The commit has passed its wait for saves; B starts copying R and stops in the exists check.
    const committed = commit(hashA, new Set([hashA]));
    let release!: () => void;
    files.gates.exists = new Promise<void>((resolve) => (release = resolve));
    files.gates.existsCalled = deferred();
    const loaded = session.recordingLoaded(file);
    await files.gates.existsCalled.promise;
    saves.resolve();
    const outcome = await committed;
    release();
    await loaded;
    expect(outcome?.recording).toBe('kept');
    expect(files.has('recording', r, 'mp3')).toBe(true);
    const bHash = await hashBytes(new Uint8Array([2]));
    expect((await library.find(bHash))?.recording?.hash).toBe(r);
  });

  it('a copy of R that starts while A’s removal is deleting R waits for the delete and copies again (KTD3)', async () => {
    const file = recFile();
    const r = await hashFile(file);
    const a = entry(hashA, { recording: rec(r) });
    const { files, session, library, commit } = await world([a]);
    const bBytes = new Uint8Array([2]);
    const bHash = await hashBytes(bBytes);
    await session.openTab(bBytes, { title: 'B', fileName: 'b.gp', fingerprint: 'fp-b' });
    let release!: () => void;
    files.gates.delete = new Promise<void>((resolve) => (release = resolve));
    const committed = commit(hashA, new Set([hashA]));
    await flush();
    // The commit has decided to delete R and is waiting on the shell; B now loads the same recording.
    const loaded = session.recordingLoaded(file);
    await flush();
    release();
    const outcome = await committed;
    await loaded;
    expect(outcome?.recording).toBe('deleted');
    expect(files.has('recording', r, 'mp3')).toBe(true);
    expect((await library.find(bHash))?.recording?.hash).toBe(r);
  });

  it('close drops every pending entry from the index without deleting files', async () => {
    const r = 'c'.repeat(64);
    const { backend, files, removals } = await world([entry(hashA, { recording: rec(r) }), entry(hashB)]);
    removals.remove(entry(hashA, { recording: rec(r) }));
    await removals.dropEntriesAll();
    expect(tabHashes(backend)).toEqual([hashB]);
    expect(files.deletes).toEqual([]);
    expect(files.has('recording', r, 'mp3')).toBe(true);
  });
});
