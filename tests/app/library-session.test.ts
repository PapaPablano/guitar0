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
