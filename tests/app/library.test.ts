import { describe, expect, it } from 'vitest';
import { isLibraryEntry, SongLibrary, type LibraryBackend, type LibraryIndex, type OpenedTab, type RecordingRef } from '../../src/app/library';

function memoryBackend(entries: unknown[] = [], quarantined = false): LibraryBackend & { data: LibraryIndex; writes: number } {
  const backend = {
    data: { version: 1, entries } as LibraryIndex,
    writes: 0,
    async read() {
      return { index: JSON.parse(JSON.stringify(backend.data)) as LibraryIndex, quarantined };
    },
    async write(index: LibraryIndex) {
      backend.writes += 1;
      backend.data = JSON.parse(JSON.stringify(index)) as LibraryIndex;
    },
  };
  return backend;
}

const failingBackend = (): LibraryBackend => ({
  read: async () => {
    throw new Error('could not read the library index');
  },
  write: async () => {
    throw new Error('disk full');
  },
});

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);

const tab = (tabHash: string, title = 'Riff', fileName = 'riff.gp', fingerprint = '64:0badcafe'): OpenedTab => ({ tabHash, title, fileName, fingerprint });

const recording = (hash: string, name = 'take.mp3'): RecordingRef => ({ hash, name, type: 'audio/mpeg', extension: 'mp3' });

describe('SongLibrary saving', () => {
  it('covers AE1: two different tabs with the same fingerprint are two songs', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    expect(await library.open(tab(hashA, 'One', 'one.gp', '64:same'), 1000)).not.toBeNull();
    expect(await library.open(tab(hashB, 'Two', 'two.gp', '64:same'), 2000)).not.toBeNull();
    expect(backend.data.entries).toHaveLength(2);
    expect((await library.list()).map((s) => s.entry.tabHash)).toEqual([hashB, hashA]);
  });

  it('saves a new song with its title, file name, fingerprint and opened time, and no backing yet', async () => {
    const library = new SongLibrary(memoryBackend());
    const entry = await library.open(tab(hashA, 'Riff', 'riff.gp', '64:abc'), 1234);
    expect(entry).toEqual({
      tabHash: hashA,
      title: 'Riff',
      fileName: 'riff.gp',
      fingerprint: '64:abc',
      openedAt: 1234,
      recording: null,
      video: null,
      source: null,
      trackIndex: 0,
      tuningId: 'file',
    });
  });

  it('stores the file name as the title when the score title is empty', async () => {
    const library = new SongLibrary(memoryBackend());
    expect((await library.open(tab(hashA, '   ', 'solo.gp5'), 1))?.title).toBe('solo.gp5');
  });

  it('covers R11: reopening the same tab bytes updates the opened time and keeps recording, video, source and setup', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    await library.open(tab(hashA), 1000);
    await library.setRecording(hashA, recording(hashC));
    await library.setVideo(hashA, { videoId: 'dQw4w9WgXcQ', offsetSeconds: 1.5 });
    await library.setSource(hashA, 'video');
    await library.setTrackAndTuning(hashA, 2, 'drop-d');
    const again = await library.open(tab(hashA, 'Riff (renamed)', 'riff-copy.gp'), 5000);
    expect(again).toMatchObject({
      openedAt: 5000,
      title: 'Riff (renamed)',
      fileName: 'riff-copy.gp',
      recording: recording(hashC),
      video: { videoId: 'dQw4w9WgXcQ', offsetSeconds: 1.5 },
      source: 'video',
      trackIndex: 2,
      tuningId: 'drop-d',
    });
    expect(backend.data.entries).toHaveLength(1);
  });

  it('covers R5: a new recording replaces only the recording', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA), 1);
    await library.setRecording(hashA, recording(hashB, 'old.mp3'));
    await library.setVideo(hashA, { videoId: 'vid', offsetSeconds: 2 });
    await library.setSource(hashA, 'video');
    expect(await library.setRecording(hashA, recording(hashC, 'new.wav'))).toBe(true);
    expect(await library.find(hashA)).toMatchObject({ recording: recording(hashC, 'new.wav'), video: { videoId: 'vid', offsetSeconds: 2 }, source: 'video' });
  });

  it('covers R5: clearing the recording removes the reference and keeps the video and source', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA), 1);
    await library.setRecording(hashA, recording(hashB));
    await library.setVideo(hashA, { videoId: 'vid', offsetSeconds: 0 });
    await library.setSource(hashA, 'recording');
    expect(await library.clearRecording(hashA)).toBe(true);
    expect(await library.find(hashA)).toMatchObject({ recording: null, video: { videoId: 'vid', offsetSeconds: 0 }, source: 'recording' });
  });

  it('removes the video when set to null', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA), 1);
    await library.setVideo(hashA, { videoId: 'vid', offsetSeconds: 3 });
    expect(await library.setVideo(hashA, null)).toBe(true);
    expect((await library.find(hashA))?.video).toBeNull();
  });

  it('covers R6: saves the chosen track and file tuning', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA), 1);
    expect(await library.setTrackAndTuning(hashA, 3, 'eb-standard')).toBe(true);
    expect(await library.find(hashA)).toMatchObject({ trackIndex: 3, tuningId: 'eb-standard' });
  });

  it('reports not saved for a change to a song that is not in the library, and writes nothing', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    expect(await library.setRecording(hashA, recording(hashB))).toBe(false);
    expect(await library.setTrackAndTuning(hashA, 1, 'file')).toBe(false);
    expect(backend.writes).toBe(0);
  });

  it('refuses a tab hash that is not a 64-hex sha256', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    expect(await library.open(tab('not-a-hash'), 1)).toBeNull();
    expect(await library.open(tab(hashA.toUpperCase()), 1)).toBeNull();
    expect(backend.writes).toBe(0);
  });

  it('runs changes in order, so a change made right after open is not lost', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    const opened = library.open(tab(hashA), 1);
    const changed = library.setTrackAndTuning(hashA, 4, 'file');
    expect(await opened).not.toBeNull();
    expect(await changed).toBe(true);
    expect((await library.find(hashA))?.trackIndex).toBe(4);
  });

  it('keeps entries it cannot read when it writes the index back', async () => {
    const odd = { tabHash: 'zz', note: 'from a newer app' };
    const backend = memoryBackend([odd]);
    const library = new SongLibrary(backend);
    await library.open(tab(hashA), 1);
    expect(backend.data.entries).toContainEqual(odd);
    expect(await library.list()).toHaveLength(1);
  });

  it('keeps fields it does not know on an entry it updates', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    await library.open(tab(hashA), 1);
    (backend.data.entries[0] as unknown as Record<string, unknown>).extra = 7;
    await library.open(tab(hashA), 2);
    expect((backend.data.entries[0] as unknown as Record<string, unknown>).extra).toBe(7);
  });

  it('saves after a quarantined index, starting from an empty library', async () => {
    const backend = memoryBackend([], true);
    const library = new SongLibrary(backend);
    expect(await library.open(tab(hashA), 1)).not.toBeNull();
    expect(backend.data.entries).toHaveLength(1);
  });

  it("starts a new song with the YouTube store's video and offset for the tab", async () => {
    const library = new SongLibrary(memoryBackend());
    const entry = await library.open(tab(hashA), 1, { videoId: 'vid', offsetSeconds: 1.75 });
    expect(entry?.video).toEqual({ videoId: 'vid', offsetSeconds: 1.75 });
    expect((await library.find(hashA))?.video).toEqual({ videoId: 'vid', offsetSeconds: 1.75 });
  });

  it('keeps an existing song\'s own video, or lack of one, over the store\'s (KTD4)', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA), 1);
    expect((await library.open(tab(hashA), 2, { videoId: 'vid', offsetSeconds: 1 }))?.video).toBeNull();
    await library.open(tab(hashB), 1);
    await library.setVideo(hashB, { videoId: 'mine', offsetSeconds: 3 });
    expect((await library.open(tab(hashB), 2, { videoId: 'vid', offsetSeconds: 1 }))?.video).toEqual({ videoId: 'mine', offsetSeconds: 3 });
  });
});

describe('the saved position (KTD2)', () => {
  const stored = { tabHash: hashA, title: 'Riff', fileName: 'riff.gp', fingerprint: '1:x', openedAt: 1, recording: null, video: null, source: null, trackIndex: 0, tuningId: 'file' };

  it('accepts an entry with no position or a non-negative whole-number position', () => {
    expect(isLibraryEntry(stored)).toBe(true);
    expect(isLibraryEntry({ ...stored, position: 0 })).toBe(true);
    expect(isLibraryEntry({ ...stored, position: 3 })).toBe(true);
  });

  it('rejects a negative, fractional, non-numeric or null position', () => {
    for (const position of [-1, 1.5, '3', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isLibraryEntry({ ...stored, position })).toBe(false);
    }
  });

  it('saves the position once, leaving the opened time alone, and the same index again writes nothing', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    await library.open(tab(hashA), 1000);
    const before = backend.writes;
    expect(await library.setPosition(hashA, 3)).toBe(true);
    expect(backend.writes - before).toBe(1);
    expect(await library.find(hashA)).toMatchObject({ position: 3, openedAt: 1000 });
    expect(await library.setPosition(hashA, 3)).toBe(true);
    expect(backend.writes - before).toBe(1);
  });

  it('refuses an invalid index without writing, keeping the saved one', async () => {
    const backend = memoryBackend();
    const library = new SongLibrary(backend);
    await library.open(tab(hashA), 1);
    await library.setPosition(hashA, 2);
    const before = backend.writes;
    expect(await library.setPosition(hashA, -1)).toBe(false);
    expect(await library.setPosition(hashA, 1.5)).toBe(false);
    expect(backend.writes).toBe(before);
    expect((await library.find(hashA))?.position).toBe(2);
  });

  it('reports not saved for a song that is not in the library, or when the backend fails', async () => {
    const backend = memoryBackend();
    expect(await new SongLibrary(backend).setPosition(hashA, 1)).toBe(false);
    expect(backend.writes).toBe(0);
    await expect(new SongLibrary(failingBackend()).setPosition(hashA, 1)).resolves.toBe(false);
  });

  it('keeps the saved position when the same tab opens again', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA), 1);
    await library.setPosition(hashA, 7);
    expect((await library.open(tab(hashA), 2))?.position).toBe(7);
    expect((await library.find(hashA))?.position).toBe(7);
  });

  it('changes only the position, keeping backing and setup', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA), 1);
    await library.setRecording(hashA, recording(hashC));
    await library.setTrackAndTuning(hashA, 2, 'drop-d');
    await library.setPosition(hashA, 4);
    expect(await library.find(hashA)).toMatchObject({ recording: recording(hashC), trackIndex: 2, tuningId: 'drop-d', position: 4 });
  });
});

describe('SongLibrary listing', () => {
  it('covers R7: orders by last opened, newest first', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA, 'Alpha', 'a.gp'), 3000);
    await library.open(tab(hashB, 'Bravo', 'b.gp'), 1000);
    await library.open(tab(hashC, 'Charlie', 'c.gp'), 2000);
    expect((await library.list()).map((s) => s.entry.title)).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });

  it('covers R7: two songs titled "Riff" both show their file names; a unique title does not', async () => {
    const library = new SongLibrary(memoryBackend());
    await library.open(tab(hashA, 'Riff', 'riff-live.gp'), 1);
    await library.open(tab(hashB, 'Riff', 'riff-studio.gp'), 2);
    await library.open(tab(hashC, 'Solo', 'solo.gp'), 3);
    const listed = await library.list();
    expect(listed.map((s) => [s.title, s.showFileName])).toEqual([
      ['Solo', false],
      ['Riff', true],
      ['Riff', true],
    ]);
  });

  it('lists an entry with an empty title under its file name', async () => {
    const entry = { tabHash: hashA, title: '', fileName: 'untitled.gp', fingerprint: '1:x', openedAt: 1, recording: null, video: null, source: null, trackIndex: 0, tuningId: 'file' };
    const listed = await new SongLibrary(memoryBackend([entry])).list();
    expect(listed[0].title).toBe('untitled.gp');
  });
});

describe('SongLibrary failure handling (R12)', () => {
  it('reads as empty and reports every change as not saved when the backend fails, without throwing', async () => {
    const library = new SongLibrary(failingBackend());
    await expect(library.list()).resolves.toEqual([]);
    await expect(library.find(hashA)).resolves.toBeNull();
    await expect(library.open(tab(hashA), 1)).resolves.toBeNull();
    await expect(library.setRecording(hashA, recording(hashB))).resolves.toBe(false);
    await expect(library.clearRecording(hashA)).resolves.toBe(false);
    await expect(library.setVideo(hashA, null)).resolves.toBe(false);
    await expect(library.setSource(hashA, 'video')).resolves.toBe(false);
    await expect(library.setTrackAndTuning(hashA, 1, 'file')).resolves.toBe(false);
  });

  it('does not write when the read fails, so an unreadable index is never overwritten', async () => {
    let wrote = false;
    const library = new SongLibrary({
      read: async () => {
        throw new Error('locked');
      },
      write: async () => {
        wrote = true;
      },
    });
    expect(await library.open(tab(hashA), 1)).toBeNull();
    expect(wrote).toBe(false);
  });

  it('reports not saved when the write fails', async () => {
    const backend = memoryBackend();
    backend.write = async () => {
      throw new Error('disk full');
    };
    expect(await new SongLibrary(backend).open(tab(hashA), 1)).toBeNull();
  });

  it('reads a malformed index answer as empty', async () => {
    const library = new SongLibrary({ read: async () => ({ index: null, quarantined: false }) as never, write: async () => undefined });
    await expect(library.list()).resolves.toEqual([]);
  });

  it('keeps working after a failed operation', async () => {
    const backend = memoryBackend();
    const write = backend.write;
    let fail = true;
    backend.write = async (index) => {
      if (fail) throw new Error('disk full');
      return write(index);
    };
    const library = new SongLibrary(backend);
    expect(await library.open(tab(hashA), 1)).toBeNull();
    fail = false;
    expect(await library.open(tab(hashA), 2)).not.toBeNull();
  });
});
