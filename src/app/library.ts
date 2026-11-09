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
  /**
   * The played bar (repeats expanded) the player was on, as a zero-based index, saved on leave, pause and window close.
   * Absent on songs saved before positions existed, which open at bar 1 (KTD2).
   */
  position?: number;
  /** The player's own name for the song (KTD1), shown instead of `title`. Absent until renamed; one line, trimmed, at most 120 characters. */
  customTitle?: string;
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
  /** The title to show: the custom title, else the entry's title, or its file name when the title is empty. */
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
    typeof e.tuningId === 'string' &&
    (e.position === undefined || (Number.isInteger(e.position) && e.position >= 0)) &&
    (e.customTitle === undefined || isCustomTitle(e.customTitle))
  );
}

/** The longest custom title, in UTF-16 code units. */
export const TITLE_MAX = 120;

const LINE_BREAK = /[\r\n]/;

function isCustomTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= TITLE_MAX && !LINE_BREAK.test(value);
}

/**
 * A typed name as a custom title: line breaks and the spaces around them become one space, the ends are trimmed, and it
 * is cut to `TITLE_MAX` without splitting a character. Empty means "no custom title".
 */
export function cleanTitle(input: string): string {
  let title = input.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (title.length > TITLE_MAX) {
    title = title.slice(0, TITLE_MAX);
    const last = title.charCodeAt(title.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) title = title.slice(0, -1);
    title = title.trimEnd();
  }
  return title;
}

export function displayTitle(entry: Pick<LibraryEntry, 'title' | 'fileName' | 'customTitle'>): string {
  if (entry.customTitle !== undefined && entry.customTitle.trim() !== '') return entry.customTitle;
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

/** What the caller must know when a removal commits (KTD2): which of the removed song's files to delete. */
export interface CommittedRemoval {
  /** The entry as it was in the index when it was removed. */
  entry: LibraryEntry;
  /** Delete the stored tab. False while a copy of it is being stored, or another stored entry still names it. */
  deleteTab: boolean;
  /** Delete the stored recording. False when there is none, or anything else still uses it or is storing it. */
  deleteRecording: boolean;
}

/** The page's live view of other library work, read when the commit step runs, not when it is queued. */
export interface RemovalContext {
  /** Tab hashes of every pending removal, including the one committing. Its absence means it was cancelled (R6). */
  pendingHashes: ReadonlySet<string>;
  /** Content hashes whose copy `store()` is writing right now; their files are never deleted (KTD3, R13). */
  storingHashes: ReadonlySet<string>;
  /**
   * Told which files the commit will delete, inside its step and before the index is written, so a copy of one of them
   * that starts from here on can wait for the delete instead of taking the "already stored" shortcut (KTD3).
   */
  beforeWrite?: (removal: CommittedRemoval) => void;
}

/**
 * Each stored entry's JSON, made once for `namedBy`: undefined when it has none, null when it cannot be serialized (so it
 * counts as naming every file).
 */
function entryTexts(entries: readonly unknown[]): (string | undefined | null)[] {
  return entries.map((e) => {
    try {
      return JSON.stringify(e);
    } catch {
      return null;
    }
  });
}

/** Whether any of these stored entries, readable or not, mentions the hash anywhere in its JSON (from `entryTexts`). */
function namedBy(texts: readonly (string | undefined | null)[], hash: string): boolean {
  // An entry that cannot be serialized cannot be checked, so it counts as naming the file.
  return texts.some((text) => text === null || (text?.includes(hash) ?? false));
}

/** The song library over a backend. Changes run one at a time, so two quick changes never overwrite each other. */
export class SongLibrary {
  private queue: Promise<unknown> = Promise.resolve();
  private quarantinedSeen = false;

  constructor(private readonly backend: LibraryBackend) {}

  /**
   * Whether any read this session found the index unreadable and had the shell set it aside (KTD5). The shell reports it
   * only once, so it is kept here for the start-screen message.
   */
  get quarantined(): boolean {
    return this.quarantinedSeen;
  }

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

  /** Saves the played bar the player was on. The opened time is left alone, and the same index again writes nothing. */
  setPosition(tabHash: string, index: number): Promise<boolean> {
    return this.change(tabHash, { position: index });
  }

  /**
   * Sets the player's name for the song (KTD1, R1), cleaned by `cleanTitle`. An empty name removes it, so the tab's own
   * title shows again. False when the song is not saved or the index cannot be read or written.
   */
  rename(tabHash: string, title: string): Promise<boolean> {
    const cleaned = cleanTitle(title);
    return this.change(tabHash, { customTitle: cleaned === '' ? undefined : cleaned });
  }

  /**
   * Commits a pending removal as one step (KTD2, KTD3): checks it is still pending, removes the entry from a fresh read
   * of the index, writes the index, and says which files to delete. The tab is deleted unless a copy is being stored or
   * another stored entry still names it. The recording is deleted only when no remaining entry, readable or not, names
   * its hash anywhere and no copy of it is being stored. Other pending removals count, since their entries stay in the
   * index until they commit. Null, with nothing changed, when the removal was
   * cancelled, the song is not saved, or the index cannot be read or written; then nothing may be deleted.
   */
  commitRemoval(tabHash: string, context: RemovalContext): Promise<CommittedRemoval | null> {
    return this.serial(async () => {
      if (!context.pendingHashes.has(tabHash)) return null;
      const entries = await this.readEntries();
      const at = entries.findIndex((e) => isSong(e, tabHash));
      if (at < 0) return null;
      const entry = entries[at] as LibraryEntry;
      const remaining = entries.filter((_, i) => i !== at);
      const texts = entryTexts(remaining);
      const recordingHash = entry.recording?.hash;
      const deleteRecording =
        recordingHash !== undefined &&
        !context.storingHashes.has(recordingHash) &&
        !namedBy(texts, recordingHash);
      const deleteTab = !context.storingHashes.has(tabHash) && !namedBy(texts, tabHash);
      const removal = { entry, deleteTab, deleteRecording };
      context.beforeWrite?.(removal);
      await this.backend.write({ version: 1, entries: remaining });
      return removal;
    }, null);
  }

  /**
   * Removes, in one step, every entry whose tab hash is pending when the step runs, for the window close (KTD2). Nothing
   * is deleted: the startup sweep removes the files once nothing names them. Unreadable entries are kept. False when the
   * index cannot be read or written.
   */
  removeEntries(pendingHashes: ReadonlySet<string>): Promise<boolean> {
    return this.serial(async () => {
      const entries = await this.readEntries();
      const remaining = entries.filter((e) => !(isLibraryEntry(e) && pendingHashes.has(e.tabHash)));
      if (remaining.length < entries.length) await this.backend.write({ version: 1, entries: remaining });
      return true;
    }, false);
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
    if (read?.quarantined === true) this.quarantinedSeen = true;
    return [...entriesOf(read?.index)];
  }

  /** Runs after every earlier operation; any failure gives `fallback` instead of throwing. */
  private serial<T>(run: () => Promise<T>, fallback: T): Promise<T> {
    const result = this.queue.then(run).catch(() => fallback);
    this.queue = result;
    return result;
  }
}
