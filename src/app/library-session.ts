/**
 * Keeps the open song's library entry current on desktop (R1, R3–R7): what to save when a tab opens, a recording loads or
 * is removed, a video is attached or moved, the track, tuning or source change, or the position is saved. Every save runs
 * in the background and never rejects, so the library can never block or break opening and playing a file (R12); a caller
 * that must read a song back first waits for its saves with `settled` (KTD3). On the web there is no session and every
 * call does nothing (R17).
 */

import { FILE_TUNING } from '../model/retune';
import { WRITTEN } from './file-tuning-options';
import type { BackingSource, LibraryEntry, OpenedTab, RecordingRef, SongLibrary, VideoRef } from './library';
import type { AudioSource } from './youtube-dock';

/** The one note shown when a recording plays but could not be copied into the library (R14). */
export const RECORDING_NOT_SAVED = "This recording wasn't saved to your library. It plays now, but you'll need to load it again next time.";

/** Copying files into the library; each gives null when not saved and never rejects. */
export interface LibraryFiles {
  /** Stores the tab's bytes; their hash, or null. */
  saveTab(bytes: Uint8Array): Promise<string | null>;
  saveRecording(file: File): Promise<RecordingRef | null>;
}

export interface LibraryDeps {
  library: Pick<SongLibrary, 'open' | 'setRecording' | 'clearRecording' | 'setVideo' | 'setSource' | 'setTrackAndTuning' | 'setPosition'>;
  files: LibraryFiles;
  now: () => number;
  /** Shows a short note in the player view. */
  onNote: (text: string) => void;
}

export interface LibrarySession {
  /**
   * Saves the opened tab as the current song. `initialVideo` is the video the YouTube store already has for the tab; it
   * becomes the song's video only when the song is new. Its tab hash once saved, or null when it was not.
   */
  openTab(bytes: Uint8Array, details: Omit<OpenedTab, 'tabHash'>, initialVideo?: VideoRef | null): Promise<string | null>;
  /** No song is open now (the sample, or back to the start screen); later changes save nothing. */
  closeSong(): void;
  /** Copies a recording that is now playing into the library and makes it the song's recording (R3, R14). */
  recordingLoaded(file: File): Promise<void>;
  /** Clears the song's recording; the stored copy stays (R5). */
  recordingRemoved(): Promise<void>;
  /** A video attach, removal or offset change the player made (KTD4); quick runs save only the latest. */
  videoChanged(video: VideoRef | null): Promise<void>;
  sourceChanged(source: BackingSource): Promise<void>;
  trackAndTuningChanged(trackIndex: number, tuningId: string): Promise<void>;
  /** Saves the open song's position, a zero-based played-bar index (R7). */
  positionChanged(index: number): Promise<void>;
  /** Saves a position to the song with this tab hash, whichever song is open now, for leaving a song (KTD1). */
  savePosition(tabHash: string, index: number): Promise<void>;
  /**
   * Resolves once every save for the song with this tab hash has finished, including saves started while it waits, so a
   * read issued afterwards sees them (KTD3). Saves for other songs are not waited on. Never rejects.
   */
  settled(tabHash: string): Promise<void>;
}

/** Which backing the song remembers for the YouTube hook's source: Original is the video's own audio. */
export function backingSourceFor(source: AudioSource): BackingSource {
  return source === 'original' ? 'video' : 'recording';
}

/** The library's id for a file tuning choice: "as written" is the file's own tuning. */
export function entryTuningId(fileTuningId: string): string {
  return fileTuningId === WRITTEN ? FILE_TUNING : fileTuningId;
}

/** The recordings saved songs use, whose profiles the cap must keep (KTD6). */
export function libraryRecordingHashes(entries: readonly LibraryEntry[]): Set<string> {
  return new Set(entries.flatMap((e) => (e.recording ? [e.recording.hash] : [])));
}

/** The song a save goes to: the promise of its hash, and the hash itself once known (`undefined` while the tab is being saved). */
interface SongKey {
  hash: Promise<string | null>;
  tabHash?: string | null;
}

/** One opened song. Its hash is a promise so changes made before the tab is saved wait for it. */
interface OpenSong extends SongKey {
  /** Bumped by every recording load or removal, so only the latest one decides the song's recording. */
  recordingRun: number;
  saveVideo: (video: VideoRef | null) => Promise<void>;
}

const NOTHING = Promise.resolve(null);
const DONE = Promise.resolve();

const webSession: LibrarySession = {
  openTab: () => NOTHING,
  closeSong: () => undefined,
  recordingLoaded: () => DONE,
  recordingRemoved: () => DONE,
  videoChanged: () => DONE,
  sourceChanged: () => DONE,
  trackAndTuningChanged: () => DONE,
  positionChanged: () => DONE,
  savePosition: () => DONE,
  settled: () => DONE,
};

/** Writes the latest value given, one write at a time: values given while a write runs collapse into the last one. */
function latestOnly<T>(write: (value: T) => Promise<unknown>): (value: T) => Promise<void> {
  let pending: { value: T } | null = null;
  let running: Promise<void> | null = null;
  return (value) => {
    pending = { value };
    if (!running) {
      running = (async () => {
        while (pending) {
          const next = pending.value;
          pending = null;
          await write(next).catch(() => undefined);
        }
        running = null;
      })();
    }
    return running;
  };
}

/** The library session for the desktop, or one that saves nothing when `deps` is null (the web). */
export function createLibrarySession(deps: LibraryDeps | null): LibrarySession {
  if (!deps) return webSession;
  const { library, files, now, onNote } = deps;
  let current: OpenSong | null = null;
  /** Saves still running, each with the song it goes to. */
  const inFlight = new Set<{ song: SongKey; done: Promise<void> }>();

  /** Counts a save as pending for `song` until it finishes. The promise returned never rejects. */
  function track(song: SongKey, save: Promise<unknown>): Promise<void> {
    const item = { song, done: save.then(() => undefined, () => undefined) };
    inFlight.add(item);
    void item.done.then(() => inFlight.delete(item));
    return item.done;
  }

  /** Runs a change against the open song's entry once its tab is saved. */
  function withSong(change: (hash: string) => Promise<unknown>): Promise<void> {
    const song = current;
    return song ? track(song, song.hash.then((hash) => (hash ? change(hash) : undefined))) : DONE;
  }

  /** Copies a recording into the library and makes it the song's recording, unless a newer change decides it instead. */
  async function saveRecording(song: OpenSong, file: File): Promise<void> {
    const run = ++song.recordingRun;
    const tabHash = await song.hash;
    if (!tabHash) return;
    let saved = false;
    try {
      const ref = await files.saveRecording(file);
      // A newer recording, or the recording's removal, decides the song's recording instead.
      if (song.recordingRun !== run) return;
      saved = ref !== null && (await library.setRecording(tabHash, ref));
    } catch {
      saved = false;
    }
    // The note is about the recording playing now, so it is not shown once another song is open.
    if (!saved && song === current && song.recordingRun === run) onNote(RECORDING_NOT_SAVED);
  }

  return {
    openTab(bytes, details, initialVideo = null) {
      const song = { recordingRun: 0 } as OpenSong;
      song.hash = (async () => {
        let saved: string | null = null;
        try {
          const tabHash = await files.saveTab(bytes);
          if (tabHash && (await library.open({ tabHash, ...details }, now(), initialVideo))) saved = tabHash;
        } catch {
          saved = null;
        }
        // Set before anything awaiting the hash runs, so `settled` knows which song this is.
        song.tabHash = saved;
        return saved;
      })();
      const writeVideo = latestOnly(async (video: VideoRef | null) => {
        const tabHash = await song.hash;
        if (tabHash) await library.setVideo(tabHash, video);
      });
      // A run already going takes the new value too; it is tracked again, which is harmless.
      song.saveVideo = (video) => track(song, writeVideo(video));
      current = song;
      track(song, song.hash);
      return song.hash;
    },

    closeSong() {
      current = null;
    },

    recordingLoaded(file) {
      // The song open when the recording loaded gets it, even if another song opens before the copy finishes.
      const song = current;
      return song ? track(song, saveRecording(song, file)) : DONE;
    },

    recordingRemoved() {
      const song = current;
      if (!song) return DONE;
      song.recordingRun += 1;
      return track(song, song.hash.then((tabHash) => (tabHash ? library.clearRecording(tabHash) : false)));
    },

    videoChanged(video) {
      return current ? current.saveVideo(video) : DONE;
    },

    sourceChanged(source) {
      return withSong((hash) => library.setSource(hash, source));
    },

    trackAndTuningChanged(trackIndex, tuningId) {
      return withSong((hash) => library.setTrackAndTuning(hash, trackIndex, tuningId));
    },

    positionChanged(index) {
      return withSong((hash) => library.setPosition(hash, index));
    },

    savePosition(tabHash, index) {
      return track({ hash: Promise.resolve(tabHash), tabHash }, library.setPosition(tabHash, index));
    },

    async settled(tabHash) {
      for (;;) {
        const waits: Promise<unknown>[] = [];
        for (const { song, done } of inFlight) {
          // A song whose tab is still being saved may be this one; its hash (which never rejects) says.
          if (song.tabHash === undefined) waits.push(song.hash);
          else if (song.tabHash === tabHash) waits.push(done);
        }
        if (waits.length === 0) return;
        await Promise.all(waits);
      }
    },
  };
}
