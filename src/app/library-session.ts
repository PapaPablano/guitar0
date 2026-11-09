/**
 * Keeps the open song's library entry current on desktop (R1, R3–R6): what to save when a tab opens, a recording loads or
 * is removed, a video is attached or moved, or the track, tuning or source change. Every save runs in the background and
 * never rejects, so the library can never block or break opening and playing a file (R12). On the web there is no
 * session and every call does nothing (R17).
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
  library: Pick<SongLibrary, 'open' | 'setRecording' | 'clearRecording' | 'setVideo' | 'setSource' | 'setTrackAndTuning'>;
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

/** One opened song. Its hash is a promise so changes made before the tab is saved wait for it. */
interface OpenSong {
  hash: Promise<string | null>;
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

  /** Runs a change against the open song's entry once its tab is saved. */
  async function withSong(change: (hash: string) => Promise<unknown>): Promise<void> {
    const hash = await (current?.hash ?? NOTHING);
    if (hash) await change(hash).catch(() => undefined);
  }

  return {
    openTab(bytes, details, initialVideo = null) {
      const hash = (async () => {
        try {
          const tabHash = await files.saveTab(bytes);
          if (!tabHash) return null;
          return (await library.open({ tabHash, ...details }, now(), initialVideo)) ? tabHash : null;
        } catch {
          return null;
        }
      })();
      const saveVideo = latestOnly(async (video: VideoRef | null) => {
        const tabHash = await hash;
        if (tabHash) await library.setVideo(tabHash, video);
      });
      current = { hash, recordingRun: 0, saveVideo };
      return hash;
    },

    closeSong() {
      current = null;
    },

    async recordingLoaded(file) {
      // The song open when the recording loaded gets it, even if another song opens before the copy finishes.
      const song = current;
      if (!song) return;
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
    },

    async recordingRemoved() {
      const song = current;
      if (!song) return;
      song.recordingRun += 1;
      const tabHash = await song.hash;
      if (tabHash) await library.clearRecording(tabHash).catch(() => undefined);
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
  };
}
