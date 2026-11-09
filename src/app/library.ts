/**
 * The song library's index: one entry per tab file the player opened on desktop, keyed by the SHA-256 of the tab's bytes
 * (not its timing fingerprint, which different tabs can share). The shell stores the index and the copied files; this
 * module only decides what the entries say. Every failure reads as "not saved" or an empty list, so the library can never
 * block opening a file the normal way.
 */

import { FILE_TUNING } from '../model/retune';

/** The library's copy of a recording. `hash` is the SHA-256 of its bytes, the same hash the per-recording stores use. */
export interface RecordingRef {
  hash: string;
  /** The player's file name, given back to the rebuilt File. */
  name: string;
  /** The file's MIME type, given back to the rebuilt File. */
  type: string;
  /** The stored file's extension, as the shell accepted it. */
  extension: string;
}

export interface VideoRef {
  videoId: string;
  offsetSeconds: number;
}

/** Which backing the player last chose for the song. */
export type BackingSource = 'recording' | 'video';

export interface LibraryEntry {
  /** SHA-256 of the tab file's bytes as lowercase hex: the song's identity. */
  tabHash: string;
  /** The score title, or the file name when the score has none. */
  title: string;
  fileName: string;
  /** The tab's timing fingerprint (`tabFingerprint`), which links the song to the YouTube store. */
  fingerprint: string;
  /** When the song was last opened, in milliseconds since the epoch. */
  openedAt: number;
  recording: RecordingRef | null;
  video: VideoRef | null;
  source: BackingSource | null;
  trackIndex: number;
  /** A tuning preset id, or `FILE_TUNING` for the tuning written in the file. */
  tuningId: string;
}

/** The index as the shell stores it. Entries this version cannot read are kept as they are. */
export interface LibraryIndex {
  version: 1;
  entries: unknown[];
}

/** Where the index lives. The desktop build keeps it in the shell's data folder. A read that rejects means "do not save". */
export interface LibraryBackend {
  read(): Promise<{ index: LibraryIndex; quarantined: boolean }>;
  write(index: LibraryIndex): Promise<void>;
}

/** What the start screen shows for one song. */
export interface LibraryListing {
  entry: LibraryEntry;
  /** The title to show: the entry's title, or its file name when the title is empty. */
  title: string;
  /** True when another song has the same title, so the file name is shown too. */
  showFileName: boolean;
}

/** The tab just opened, as the library needs it. */
export interface OpenedTab {
  tabHash: string;
  title: string;
  fileName: string;
  fingerprint: string;
}

const HASH = /^[0-9a-f]{64}$/;

export function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value);
}

function isRecordingRef(value: unknown): value is RecordingRef {
  const r = value as RecordingRef;
  return !!r && typeof r === 'object' && isContentHash(r.hash) && typeof r.name === 'string' && typeof r.type === 'string' && typeof r.extension === 'string';
}

function isVideoRef(value: unknown): value is VideoRef {
  const v = value as VideoRef;
  return !!v && typeof v === 'object' && typeof v.videoId === 'string' && v.videoId !== '' && Number.isFinite(v.offsetSeconds);
}

/** Whether a stored entry is one this version can read. */
export function isLibraryEntry(value: unknown): value is LibraryEntry {
  const e = value as LibraryEntry;
  return (
    !!e &&
    typeof e === 'object' &&
    isContentHash(e.tabHash) &&
    typeof e.title === 'string' &&
    typeof e.fileName === 'string' &&
    typeof e.fingerprint === 'string' &&
    Number.isFinite(e.openedAt) &&
    (e.recording === null || isRecordingRef(e.recording)) &&
    (e.video === null || isVideoRef(e.video)) &&
    (e.source === null || e.source === 'recording' || e.source === 'video') &&
    Number.isInteger(e.trackIndex) &&
    e.trackIndex >= 0 &&
    typeof e.tuningId === 'string'
  );
}

export function displayTitle(entry: Pick<LibraryEntry, 'title' | 'fileName'>): string {
  return entry.title.trim() === '' ? entry.fileName : entry.title;
}

/** Songs last opened first; a title shared by several songs is marked so each shows its file name. */
export function listSongs(entries: readonly LibraryEntry[]): LibraryListing[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = displayTitle(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...entries]
    .sort((a, b) => b.openedAt - a.openedAt)
    .map((entry) => {
      const title = displayTitle(entry);
      return { entry, title, showFileName: (counts.get(title) ?? 0) > 1 };
    });
}

function isSong(e: unknown, tabHash: string): e is LibraryEntry {
  return isLibraryEntry(e) && e.tabHash === tabHash;
}

/** Shallow equality for a patch value: primitives by ===, objects (or null) by the same keys with === values. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

function entriesOf(index: unknown): unknown[] {
  const entries = (index as LibraryIndex | null)?.entries;
  return Array.isArray(entries) ? entries : [];
}

/** The song library over a backend. Changes run one at a time, so two quick changes never overwrite each other. */
export class SongLibrary {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly backend: LibraryBackend) {}

  /** Saved songs for the start screen; empty when the index cannot be read. */
  async list(): Promise<LibraryListing[]> {
    return this.serial(async () => listSongs((await this.readEntries()).filter(isLibraryEntry)), []);
  }

  /** The saved song for this tab hash, or null when there is none or the index cannot be read. */
  async find(tabHash: string): Promise<LibraryEntry | null> {
    return this.serial(async () => (await this.readEntries()).find((e): e is LibraryEntry => isSong(e, tabHash)) ?? null, null);
  }

  /**
   * Saves the opened tab as a song, or updates the existing song for the same bytes: its title, file name, fingerprint
   * and opened time change, and its backing and setup are kept. `initialVideo` (the video the YouTube store already has
   * for the tab) becomes a new song's video; an existing song keeps its own, since the entry is the authority (KTD4).
   * Returns the saved entry, or null when not saved.
   */
  async open(tab: OpenedTab, now: number, initialVideo: VideoRef | null = null): Promise<LibraryEntry | null> {
    if (!isContentHash(tab.tabHash)) return null;
    const title = displayTitle(tab);
    const details = { title, fileName: tab.fileName, fingerprint: tab.fingerprint, openedAt: now };
    const video = isVideoRef(initialVideo) ? { videoId: initialVideo.videoId, offsetSeconds: initialVideo.offsetSeconds } : null;
    return this.serial(async () => {
      const entries = await this.readEntries();
      const at = entries.findIndex((e) => isSong(e, tab.tabHash));
      const saved: LibraryEntry =
        at >= 0
          ? { ...(entries[at] as LibraryEntry), ...details }
          : { tabHash: tab.tabHash, ...details, recording: null, video, source: null, trackIndex: 0, tuningId: FILE_TUNING };
      if (at >= 0) entries[at] = saved;
      else entries.push(saved);
      await this.backend.write({ version: 1, entries });
      return saved;
    }, null);
  }

  /** Makes this the song's recording, replacing only the recording. */
  setRecording(tabHash: string, recording: RecordingRef): Promise<boolean> {
    return this.change(tabHash, { recording: { ...recording } });
  }

  /** Removes the song's recording reference; the stored copy, the video and the source stay. */
  clearRecording(tabHash: string): Promise<boolean> {
    return this.change(tabHash, { recording: null });
  }

  /** Saves the song's video and offset, or removes the video when null. */
  setVideo(tabHash: string, video: VideoRef | null): Promise<boolean> {
    return this.change(tabHash, { video: video && { ...video } });
  }

  setSource(tabHash: string, source: BackingSource | null): Promise<boolean> {
    return this.change(tabHash, { source });
  }

  setTrackAndTuning(tabHash: string, trackIndex: number, tuningId: string): Promise<boolean> {
    return this.change(tabHash, { trackIndex, tuningId });
  }

  /** Applies a change to a saved song. False when the song is not saved or the index cannot be read or written. */
  private change(tabHash: string, patch: Partial<LibraryEntry>): Promise<boolean> {
    return this.serial(async () => {
      const entries = await this.readEntries();
      const at = entries.findIndex((e) => isSong(e, tabHash));
      if (at < 0) return false;
      const stored = entries[at] as LibraryEntry;
      if ((Object.keys(patch) as (keyof LibraryEntry)[]).every((k) => sameValue(stored[k], patch[k]))) return true;
      const next = { ...stored, ...patch };
      if (!isLibraryEntry(next)) return false;
      entries[at] = next;
      await this.backend.write({ version: 1, entries });
      return true;
    }, false);
  }

  /** The stored entries as they are, readable or not, so a write keeps what this version cannot read. */
  private async readEntries(): Promise<unknown[]> {
    const read = await this.backend.read();
    return [...entriesOf(read?.index)];
  }

  /** Runs after every earlier operation; any failure gives `fallback` instead of throwing. */
  private serial<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    const result = this.queue.then(run).catch(() => fallback);
    this.queue = result;
    return result;
  }
}
