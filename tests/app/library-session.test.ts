import { describe, expect, it } from 'vitest';
import { SongLibrary, type LibraryBackend, type LibraryEntry, type LibraryIndex, type RecordingRef } from '../../src/app/library';
import {
  backingSourceFor,
  createLibrarySession,
  entryTuningId,
  libraryRecordingHashes,
  RECORDING_NOT_SAVED,
  type LibraryFiles,
} from '../../src/app/library-session';
import { WRITTEN } from '../../src/app/file-tuning-options';
import { FILE_TUNING } from '../../src/model/retune';

function memoryBackend(): LibraryBackend & { data: LibraryIndex; writes: number } {
  const backend = {
    data: { version: 1, entries: [] } as LibraryIndex,
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

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const recHash = 'c'.repeat(64);
const recHash2 = 'd'.repeat(64);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const refFor = (hash: string, name = 'take.mp3'): RecordingRef => ({ hash, name, type: 'audio/mpeg', extension: 'mp3' });

/** Tab bytes name their own hash: the first byte picks A or B. */
function fakeFiles(overrides: Partial<LibraryFiles> = {}): LibraryFiles & { tabs: number; recordings: File[] } {
  const files = {
    tabs: 0,
    recordings: [] as File[],
    async saveTab(bytes: Uint8Array) {
      files.tabs += 1;
      return bytes[0] === 2 ? hashB : hashA;
    },
    async saveRecording(file: File) {
      files.recordings.push(file);
      return refFor(file.name === 'second.mp3' ? recHash2 : recHash, file.name);
    },
    ...overrides,
  };
  return files;
}

const tabA = new Uint8Array([1, 9, 9]);
const tabB = new Uint8Array([2, 9, 9]);
const detailsA = { title: 'Song A', fileName: 'a.gp', fingerprint: 'fp-a' };
const detailsB = { title: 'Song B', fileName: 'b.gp', fingerprint: 'fp-b' };
const recording = (name = 'take.mp3') => new File([new Uint8Array([1, 2, 3])], name, { type: 'audio/mpeg' });

async function entryOf(library: SongLibrary, hash: string): Promise<LibraryEntry | null> {
  return library.find(hash);
}

function setup(files = fakeFiles()) {
  const backend = memoryBackend();
  const library = new SongLibrary(backend);
  const notes: string[] = [];
  const session = createLibrarySession({ library, files, now: () => 1000, onNote: (text) => notes.push(text) });
  return { backend, library, files, notes, session };
}

describe('opening a tab', () => {
  it('on desktop saves the tab and upserts a song with its title and file name (R1)', async () => {
    const { library, files, session } = setup();
    expect(await session.openTab(tabA, detailsA)).toBe(hashA);
    expect(files.tabs).toBe(1);
    expect(await entryOf(library, hashA)).toMatchObject({ tabHash: hashA, title: 'Song A', fileName: 'a.gp', fingerprint: 'fp-a', openedAt: 1000 });
  });

  it('uses the file name as the title when the score has none (R1)', async () => {
    const { library, session } = setup();
    await session.openTab(tabA, { ...detailsA, title: '' });
    expect((await entryOf(library, hashA))?.title).toBe('a.gp');
  });

  it('saves no song when the tab bytes could not be stored, so no entry points at a missing tab', async () => {
    const { backend, session } = setup(fakeFiles({ saveTab: async () => null }));
    expect(await session.openTab(tabA, detailsA)).toBeNull();
    expect(backend.writes).toBe(0);
  });

  it('never rejects when saving throws, so opening is never broken (R12)', async () => {
    const { session } = setup(
      fakeFiles({
        saveTab: async () => {
          throw new Error('shell gone');
        },
      }),
    );
    await expect(session.openTab(tabA, detailsA)).resolves.toBeNull();
    await expect(session.recordingLoaded(recording())).resolves.toBeUndefined();
  });

  it('writes no video when a tab opens without one from the YouTube store', async () => {
    const { library, session } = setup();
    await session.openTab(tabA, detailsA);
    expect((await entryOf(library, hashA))?.video).toBeNull();
  });

  it("starts a new song with the store's video, and leaves an existing song's video alone (KTD4)", async () => {
    const { library, session } = setup();
    const hash = await session.openTab(tabA, detailsA, { videoId: 'vid', offsetSeconds: 2 });
    expect(hash).toBe(hashA);
    expect((await entryOf(library, hashA))?.video).toEqual({ videoId: 'vid', offsetSeconds: 2 });
    await session.videoChanged(null);
    await session.openTab(tabA, detailsA, { videoId: 'other', offsetSeconds: 5 });
    expect((await entryOf(library, hashA))?.video).toBeNull();
  });

  it('records the track and file tuning the player picks (R6)', async () => {
    const { library, session } = setup();
    await session.openTab(tabA, detailsA);
    await session.trackAndTuningChanged(2, 'drop-d');
    expect(await entryOf(library, hashA)).toMatchObject({ trackIndex: 2, tuningId: 'drop-d' });
  });
});

describe('the sample and the web build', () => {
  it('the sample saves nothing, and a recording loaded on it is not copied (R1)', async () => {
    const { backend, files, session } = setup();
    await session.openTab(tabA, detailsA);
    const writes = backend.writes;
    session.closeSong();
    await session.recordingLoaded(recording());
    await session.videoChanged({ videoId: 'abc', offsetSeconds: 1 });
    await session.trackAndTuningChanged(1, FILE_TUNING);
    expect(files.recordings).toHaveLength(0);
    expect(backend.writes).toBe(writes);
  });

  it('on the web nothing is saved and nothing is called (R17)', async () => {
    const session = createLibrarySession(null);
    expect(await session.openTab(tabA, detailsA)).toBeNull();
    await session.recordingLoaded(recording());
    await session.recordingRemoved();
    await session.videoChanged({ videoId: 'abc', offsetSeconds: 0 });
    await session.sourceChanged('video');
    await session.trackAndTuningChanged(1, FILE_TUNING);
  });
});

describe('loading a recording', () => {
  it('copies it and then makes it the song recording (R3)', async () => {
    const { library, files, notes, session } = setup();
    await session.openTab(tabA, detailsA);
    await session.recordingLoaded(recording());
    expect(files.recordings).toHaveLength(1);
    expect((await entryOf(library, hashA))?.recording).toEqual(refFor(recHash));
    expect(notes).toEqual([]);
  });

  it('a failed copy changes no entry and gives one "not saved" note (R14)', async () => {
    const { library, notes, session } = setup(fakeFiles({ saveRecording: async () => null }));
    await session.openTab(tabA, detailsA);
    await session.recordingLoaded(recording());
    expect((await entryOf(library, hashA))?.recording).toBeNull();
    expect(notes).toEqual([RECORDING_NOT_SAVED]);
  });

  it('an index write that fails after the copy also gives the note (R14)', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    const notes: string[] = [];
    const session = createLibrarySession({ library, files: fakeFiles(), now: () => 1, onNote: (t) => notes.push(t) });
    await session.openTab(tabA, detailsA);
    backend.write = async () => {
      throw new Error('disk full');
    };
    await session.recordingLoaded(recording());
    expect(notes).toEqual([RECORDING_NOT_SAVED]);
  });

  it('a copy that confirms after song B opened still goes to song A, and B is unchanged', async () => {
    const copy = deferred<RecordingRef | null>();
    const { library, notes, session } = setup(fakeFiles({ saveRecording: () => copy.promise }));
    await session.openTab(tabA, detailsA);
    const loading = session.recordingLoaded(recording());
    await session.openTab(tabB, detailsB);
    copy.resolve(refFor(recHash));
    await loading;
    expect((await entryOf(library, hashA))?.recording).toEqual(refFor(recHash));
    expect((await entryOf(library, hashB))?.recording).toBeNull();
    expect(notes).toEqual([]);
  });

  it('a failed copy for song A shows no note once song B is open', async () => {
    const copy = deferred<RecordingRef | null>();
    const { notes, session } = setup(fakeFiles({ saveRecording: () => copy.promise }));
    await session.openTab(tabA, detailsA);
    const loading = session.recordingLoaded(recording());
    await session.openTab(tabB, detailsB);
    copy.resolve(null);
    await loading;
    expect(notes).toEqual([]);
  });

  it('a slower earlier copy does not replace a newer recording on the same song', async () => {
    const first = deferred<RecordingRef | null>();
    const { library, session } = setup(
      fakeFiles({ saveRecording: (file: File) => (file.name === 'second.mp3' ? Promise.resolve(refFor(recHash2, 'second.mp3')) : first.promise) }),
    );
    await session.openTab(tabA, detailsA);
    const older = session.recordingLoaded(recording('first.mp3'));
    await session.recordingLoaded(recording('second.mp3'));
    first.resolve(refFor(recHash, 'first.mp3'));
    await older;
    expect((await entryOf(library, hashA))?.recording?.hash).toBe(recHash2);
  });

  it('a copy still running when the recording is removed does not put it back', async () => {
    const copy = deferred<RecordingRef | null>();
    const { library, session } = setup(fakeFiles({ saveRecording: () => copy.promise }));
    await session.openTab(tabA, detailsA);
    const loading = session.recordingLoaded(recording());
    await session.recordingRemoved();
    copy.resolve(refFor(recHash));
    await loading;
    expect((await entryOf(library, hashA))?.recording).toBeNull();
  });

  it('removing the recording clears the reference only, keeping video and source (R5)', async () => {
    const { library, session } = setup();
    await session.openTab(tabA, detailsA);
    await session.recordingLoaded(recording());
    await session.videoChanged({ videoId: 'vid', offsetSeconds: 2 });
    await session.sourceChanged('video');
    await session.recordingRemoved();
    expect(await entryOf(library, hashA)).toMatchObject({ recording: null, video: { videoId: 'vid', offsetSeconds: 2 }, source: 'video' });
  });
});

describe('the video and source', () => {
  it('covers AE2: attaching a video then switching to it records both, with the video as source', async () => {
    const { library, session } = setup();
    await session.openTab(tabA, detailsA);
    await session.recordingLoaded(recording());
    await session.videoChanged({ videoId: 'vid', offsetSeconds: 0.5 });
    await session.sourceChanged(backingSourceFor('original'));
    expect(await entryOf(library, hashA)).toMatchObject({ recording: refFor(recHash), video: { videoId: 'vid', offsetSeconds: 0.5 }, source: 'video' });
  });

  it('a run of offset changes ends with the last one saved, without a write for each (R4)', async () => {
    const { backend, library, session } = setup();
    await session.openTab(tabA, detailsA);
    const before = backend.writes;
    const saves = [0.1, 0.2, 0.3, 0.4].map((offsetSeconds) => session.videoChanged({ videoId: 'vid', offsetSeconds }));
    await Promise.all(saves);
    expect((await entryOf(library, hashA))?.video).toEqual({ videoId: 'vid', offsetSeconds: 0.4 });
    expect(backend.writes - before).toBeLessThanOrEqual(2);
  });

  it('removing the video clears it from the song', async () => {
    const { library, session } = setup();
    await session.openTab(tabA, detailsA);
    await session.videoChanged({ videoId: 'vid', offsetSeconds: 1 });
    await session.videoChanged(null);
    expect((await entryOf(library, hashA))?.video).toBeNull();
  });
});

describe('helpers', () => {
  it('maps the hook source to the backing the song remembers', () => {
    expect(backingSourceFor('original')).toBe('video');
    expect(backingSourceFor('synth')).toBe('recording');
  });

  it('stores the file tuning as written under the library id for it', () => {
    expect(entryTuningId(WRITTEN)).toBe(FILE_TUNING);
    expect(entryTuningId('drop-d')).toBe('drop-d');
  });

  it('lists the recording hashes the library references, for the profile trim (KTD6)', () => {
    const base = { title: '', fileName: '', fingerprint: '', openedAt: 0, video: null, source: null, trackIndex: 0, tuningId: FILE_TUNING };
    const hashes = libraryRecordingHashes([
      { ...base, tabHash: hashA, recording: refFor(recHash) },
      { ...base, tabHash: hashB, recording: null },
    ]);
    expect([...hashes]).toEqual([recHash]);
  });
});

describe('the position', () => {
  it("saves the open song's position, leaving its opened time alone (R7)", async () => {
    const { library, session } = setup();
    await session.openTab(tabA, detailsA);
    await session.positionChanged(4);
    expect(await entryOf(library, hashA)).toMatchObject({ position: 4, openedAt: 1000 });
  });

  it('a position given before the tab is saved waits for it', async () => {
    const save = deferred<string | null>();
    const { library, session } = setup(fakeFiles({ saveTab: () => save.promise }));
    void session.openTab(tabA, detailsA);
    const saving = session.positionChanged(2);
    save.resolve(hashA);
    await saving;
    expect((await entryOf(library, hashA))?.position).toBe(2);
  });

  it('saves to a named song even after another song opened, leaving the open song alone', async () => {
    const { library, session } = setup();
    await session.openTab(tabA, detailsA);
    await session.openTab(tabB, detailsB);
    await session.savePosition(hashA, 6);
    expect((await entryOf(library, hashA))?.position).toBe(6);
    expect((await entryOf(library, hashB))?.position).toBeUndefined();
  });

  it('saves nothing with no song open, for the sample, or for an unsaved tab', async () => {
    const { backend, session } = setup();
    await session.positionChanged(1);
    await session.openTab(tabA, detailsA);
    session.closeSong();
    const writes = backend.writes;
    await session.positionChanged(3);
    expect(backend.writes).toBe(writes);
    const unsaved = setup(fakeFiles({ saveTab: async () => null }));
    await unsaved.session.openTab(tabA, detailsA);
    await unsaved.session.positionChanged(3);
    expect(unsaved.backend.writes).toBe(0);
  });
});

/** A library whose writes wait for the test to let them through. */
function gatedLibrary(library: SongLibrary) {
  const gates: { name: string; release: () => void }[] = [];
  const gate =
    <A extends unknown[]>(name: string, write: (tabHash: string, ...args: A) => Promise<boolean>) =>
    async (tabHash: string, ...args: A) => {
      await new Promise<void>((release) => gates.push({ name, release }));
      return write(tabHash, ...args);
    };
  const gated = {
    open: library.open.bind(library),
    setRecording: gate('setRecording', library.setRecording.bind(library)),
    clearRecording: gate('clearRecording', library.clearRecording.bind(library)),
    setVideo: gate('setVideo', library.setVideo.bind(library)),
    setSource: gate('setSource', library.setSource.bind(library)),
    setTrackAndTuning: gate('setTrackAndTuning', library.setTrackAndTuning.bind(library)),
    setPosition: gate('setPosition', library.setPosition.bind(library)),
  };
  /** Lets the waiting writes named `name` (or all of them) through. */
  const release = (name?: string) => {
    for (const g of gates.splice(0)) {
      if (!name || g.name === name) g.release();
      else gates.push(g);
    }
  };
  return { gated, gates, release };
}

/** Whether the promise has settled once pending work has had a chance to run. */
async function isDone(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await new Promise((r) => setTimeout(r, 0));
  return done;
}

function gatedSetup(files = fakeFiles()) {
  const backend = memoryBackend();
  const library = new SongLibrary(backend);
  const { gated, gates, release } = gatedLibrary(library);
  const session = createLibrarySession({ library: gated, files, now: () => 1000, onNote: () => undefined });
  return { backend, library, session, gates, release };
}

describe("waiting for a song's pending saves (KTD3)", () => {
  it('resolves at once with nothing pending', async () => {
    const { session } = setup();
    expect(await isDone(session.settled(hashA))).toBe(true);
    await session.openTab(tabA, detailsA);
    expect(await isDone(session.settled(hashA))).toBe(true);
  });

  it('waits for a video write, then resolves', async () => {
    const { library, session, release } = gatedSetup();
    await session.openTab(tabA, detailsA);
    void session.videoChanged({ videoId: 'vid', offsetSeconds: 1 });
    const settled = session.settled(hashA);
    expect(await isDone(settled)).toBe(false);
    release();
    await settled;
    expect((await library.find(hashA))?.video).toEqual({ videoId: 'vid', offsetSeconds: 1 });
  });

  it('waits for a recording copy and the setRecording after it', async () => {
    const copy = deferred<RecordingRef | null>();
    const { library, session, gates, release } = gatedSetup(fakeFiles({ saveRecording: () => copy.promise }));
    await session.openTab(tabA, detailsA);
    void session.recordingLoaded(recording());
    const settled = session.settled(hashA);
    expect(await isDone(settled)).toBe(false);
    copy.resolve(refFor(recHash));
    expect(await isDone(settled)).toBe(false);
    expect(gates.map((g) => g.name)).toEqual(['setRecording']);
    release();
    await settled;
    expect((await library.find(hashA))?.recording).toEqual(refFor(recHash));
  });

  it('waits for source, track and tuning, recording removal and position writes', async () => {
    const { library, session, gates, release } = gatedSetup();
    await session.openTab(tabA, detailsA);
    void session.sourceChanged('video');
    void session.trackAndTuningChanged(2, 'drop-d');
    void session.recordingRemoved();
    void session.positionChanged(5);
    const settled = session.settled(hashA);
    await isDone(settled);
    expect(gates.map((g) => g.name).sort()).toEqual(['clearRecording', 'setPosition', 'setSource', 'setTrackAndTuning']);
    release('setSource');
    release('setTrackAndTuning');
    release('clearRecording');
    expect(await isDone(settled)).toBe(false);
    release();
    await settled;
    expect(await library.find(hashA)).toMatchObject({ source: 'video', trackIndex: 2, tuningId: 'drop-d', position: 5 });
  });

  it('waits for a position saved to a named song', async () => {
    const { library, session, release } = gatedSetup();
    await session.openTab(tabA, detailsA);
    await session.openTab(tabB, detailsB);
    void session.savePosition(hashA, 3);
    const settled = session.settled(hashA);
    expect(await isDone(settled)).toBe(false);
    release();
    await settled;
    expect((await library.find(hashA))?.position).toBe(3);
  });

  it('also waits for writes added while it waits', async () => {
    const { library, session, release } = gatedSetup();
    await session.openTab(tabA, detailsA);
    void session.sourceChanged('video');
    const settled = session.settled(hashA);
    await isDone(settled);
    void session.positionChanged(9);
    release('setSource');
    expect(await isDone(settled)).toBe(false);
    release();
    await settled;
    expect((await library.find(hashA))?.position).toBe(9);
  });

  it('also waits for a later value collapsed into a running video write', async () => {
    const { library, session, release } = gatedSetup();
    await session.openTab(tabA, detailsA);
    void session.videoChanged({ videoId: 'vid', offsetSeconds: 1 });
    const settled = session.settled(hashA);
    await isDone(settled);
    void session.videoChanged({ videoId: 'vid', offsetSeconds: 2 });
    release();
    expect(await isDone(settled)).toBe(false);
    release();
    await settled;
    expect((await library.find(hashA))?.video).toEqual({ videoId: 'vid', offsetSeconds: 2 });
  });

  it("doesn't wait for another song's writes", async () => {
    const { session, gates } = gatedSetup();
    await session.openTab(tabB, detailsB);
    void session.videoChanged({ videoId: 'vid', offsetSeconds: 1 });
    void session.positionChanged(2);
    await session.openTab(tabA, detailsA);
    expect(await isDone(session.settled(hashA))).toBe(true);
    expect(gates).toHaveLength(2);
    expect(await isDone(session.settled(hashB))).toBe(false);
  });

  it("waits for a write queued while the song's tab was still being saved", async () => {
    const save = deferred<string | null>();
    const { session, release } = gatedSetup(fakeFiles({ saveTab: () => save.promise }));
    void session.openTab(tabA, detailsA);
    void session.positionChanged(1);
    const settled = session.settled(hashA);
    expect(await isDone(settled)).toBe(false);
    save.resolve(hashA);
    expect(await isDone(settled)).toBe(false);
    release();
    expect(await isDone(settled)).toBe(true);
  });

  it('a failed write still settles', async () => {
    const library = new SongLibrary(memoryBackend());
    const fail = async () => {
      throw new Error('disk full');
    };
    const failing = {
      open: library.open.bind(library),
      setRecording: fail,
      clearRecording: fail,
      setVideo: fail,
      setSource: fail,
      setTrackAndTuning: fail,
      setPosition: fail,
    };
    const session = createLibrarySession({ library: failing, files: fakeFiles(), now: () => 1, onNote: () => undefined });
    await session.openTab(tabA, detailsA);
    void session.videoChanged(null);
    void session.sourceChanged('video');
    void session.recordingLoaded(recording());
    void session.savePosition(hashA, 1);
    await expect(session.positionChanged(1)).resolves.toBeUndefined();
    await expect(session.settled(hashA)).resolves.toBeUndefined();
  });

  it("A→B→A: A's late video write lands before a find(A) issued after settled(A)", async () => {
    const { library, session, release } = gatedSetup();
    await session.openTab(tabA, detailsA);
    void session.videoChanged({ videoId: 'late', offsetSeconds: 4 });
    await session.openTab(tabB, detailsB);
    const settledA = session.settled(hashA);
    // The write lets go only after the reopen started waiting.
    setTimeout(release, 5);
    await settledA;
    expect((await library.find(hashA))?.video).toEqual({ videoId: 'late', offsetSeconds: 4 });
  });

  it('on the web resolves at once', async () => {
    const session = createLibrarySession(null);
    await session.positionChanged(3);
    await session.savePosition(hashA, 3);
    expect(await isDone(session.settled(hashA))).toBe(true);
  });
});

describe('waiting for every save (KTD3)', () => {
  it('waits for saves of every song, including ones started while it waits', async () => {
    const { session, release } = gatedSetup();
    await session.openTab(tabA, detailsA);
    void session.videoChanged({ videoId: 'vid', offsetSeconds: 1 });
    const all = session.settledAll();
    expect(await isDone(all)).toBe(false);
    void session.savePosition(hashB, 2);
    release();
    await all;
    expect(await isDone(session.settledAll())).toBe(true);
  });

  it('resolves at once with nothing pending, and on the web', async () => {
    expect(await isDone(setup().session.settledAll())).toBe(true);
    expect(await isDone(createLibrarySession(null).settledAll())).toBe(true);
    expect(createLibrarySession(null).storingHashes.size).toBe(0);
  });
});

describe('the storing set (KTD3, R13)', () => {
  it("holds a tab's hash from the start of its copy until the entry naming it is written", async () => {
    const copied = deferred<string | null>();
    const files = fakeFiles({
      saveTab: (_bytes, storing) => {
        storing(hashA);
        return copied.promise;
      },
    });
    const library = new SongLibrary(memoryBackend());
    const written = deferred<void>();
    const gated = {
      ...gatedLibrary(library).gated,
      open: async (...args: Parameters<SongLibrary['open']>) => {
        await written.promise;
        return library.open(...args);
      },
    };
    const session = createLibrarySession({ library: gated, files, now: () => 1, onNote: () => undefined });
    const opened = session.openTab(tabA, detailsA);
    await Promise.resolve();
    expect(session.storingHashes.has(hashA)).toBe(true);
    copied.resolve(hashA);
    expect(await isDone(opened)).toBe(false);
    expect(session.storingHashes.has(hashA)).toBe(true);
    written.resolve();
    expect(await opened).toBe(hashA);
    expect(session.storingHashes.has(hashA)).toBe(false);
  });

  it("drops a tab's hash when its copy fails", async () => {
    const files = fakeFiles({
      saveTab: async (_bytes, storing) => {
        storing(hashA);
        throw new Error('disk full');
      },
    });
    const { session } = setup(files);
    expect(await session.openTab(tabA, detailsA)).toBeNull();
    expect(session.storingHashes.has(hashA)).toBe(false);
  });

  it("holds a recording's hash until setRecording settles, and drops it when the copy fails", async () => {
    let fail = false;
    const files = fakeFiles({
      saveRecording: async (file, storing) => {
        storing(recHash);
        if (fail) return null;
        return refFor(recHash, file.name);
      },
    });
    const { session, release } = gatedSetup(files);
    const opened = session.openTab(tabA, detailsA);
    release();
    await opened;
    const loaded = session.recordingLoaded(recording());
    await isDone(loaded);
    expect(session.storingHashes.has(recHash)).toBe(true);
    release();
    await loaded;
    expect(session.storingHashes.has(recHash)).toBe(false);
    fail = true;
    await session.recordingLoaded(recording());
    expect(session.storingHashes.has(recHash)).toBe(false);
  });

  it('keeps a hash two copies hold until both have finished', async () => {
    const first = deferred<RecordingRef | null>();
    const second = deferred<RecordingRef | null>();
    const copies = [first, second];
    const files = fakeFiles({
      saveRecording: (_file, storing) => {
        storing(recHash);
        return copies.shift()!.promise;
      },
    });
    const { session } = setup(files);
    await session.openTab(tabA, detailsA);
    const a = session.recordingLoaded(recording());
    await session.openTab(tabB, detailsB);
    const b = session.recordingLoaded(recording());
    await isDone(b);
    first.resolve(refFor(recHash));
    await a;
    expect(session.storingHashes.has(recHash)).toBe(true);
    second.resolve(refFor(recHash));
    await b;
    expect(session.storingHashes.has(recHash)).toBe(false);
  });
});

describe('a removed song (R5)', () => {
  it('shows no "not saved" note when its recording copy lands after the song was left and its entry removed', async () => {
    const copy = deferred<RecordingRef | null>();
    const { library, notes, session } = setup(fakeFiles({ saveRecording: () => copy.promise }));
    await session.openTab(tabA, detailsA);
    const loaded = session.recordingLoaded(recording());
    // Removing the open song leaves it first; then its removal commits.
    session.closeSong();
    await library.commitRemoval(hashA, { pendingHashes: new Set([hashA]), storingHashes: new Set() });
    copy.resolve(refFor(recHash));
    await loaded;
    expect(notes).not.toContain(RECORDING_NOT_SAVED);
  });
});
