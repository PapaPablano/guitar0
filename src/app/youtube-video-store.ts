import { clampOffset } from '../audio/offset-range';

/** The version of the stored record; one this code does not know reads as nothing stored. */
export const YOUTUBE_RECORD_VERSION = 1;

/** The video attached to one tab and the offset saved for each video used with it. */
export interface VideoRecord {
  readonly videoId: string;
  readonly offsets: Readonly<Record<string, number>>;
}

/** The slice of Storage the store uses, so tests can pass a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'tab-highway-youtube:';

/**
 * Remembers, for each tab (by its fingerprint), which YouTube video is attached and the offset that lines each video up
 * with it. Every failure reads as nothing stored, and a save that fails is dropped: the video still plays this session.
 */
export class YoutubeVideoStore {
  constructor(private readonly storage: KeyValueStorage | null) {}

  /** The record for a tab, or null when there is none or it cannot be read. */
  load(tab: string): VideoRecord | null {
    let raw: string | null;
    try {
      raw = this.storage?.getItem(PREFIX + tab) ?? null;
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null) return null;
      const record = value as { version?: unknown; videoId?: unknown; offsets?: unknown };
      if (record.version !== YOUTUBE_RECORD_VERSION || typeof record.videoId !== 'string') return null;
      const offsets: Record<string, number> = {};
      if (typeof record.offsets === 'object' && record.offsets !== null) {
        for (const [id, offset] of Object.entries(record.offsets)) {
          if (typeof offset === 'number' && Number.isFinite(offset)) offsets[id] = clampOffset(offset);
        }
      }
      return { videoId: record.videoId, offsets };
    } catch {
      return null;
    }
  }

  /** Attaches a video to a tab, keeping the offsets saved for the videos used with it before. */
  attach(tab: string, videoId: string): void {
    const previous = this.load(tab);
    this.write(tab, { videoId, offsets: previous?.offsets ?? {} });
  }

  /** Saves the offset for the video now attached to a tab; nothing happens when none is attached. */
  saveOffset(tab: string, offset: number): void {
    const current = this.load(tab);
    if (!current || current.videoId === '') return;
    this.write(tab, { videoId: current.videoId, offsets: { ...current.offsets, [current.videoId]: clampOffset(offset) } });
  }

  /** The video attached to a tab, or null when there is none. */
  videoFor(tab: string): string | null {
    const id = this.load(tab)?.videoId;
    return id ? id : null;
  }

  /** The offset saved for the video now attached to a tab, or null when there is none. */
  offsetFor(tab: string): number | null {
    const current = this.load(tab);
    return current && current.videoId !== '' ? (current.offsets[current.videoId] ?? null) : null;
  }

  /** Removes the video from a tab. The offsets stay, so attaching the same video again finds its old alignment. */
  detach(tab: string): void {
    const current = this.load(tab);
    if (!current) return;
    const { offsets } = current;
    if (Object.keys(offsets).length === 0) {
      this.remove(tab);
      return;
    }
    this.write(tab, { videoId: '', offsets });
  }

  private write(tab: string, record: VideoRecord): void {
    try {
      this.storage?.setItem(PREFIX + tab, JSON.stringify({ version: YOUTUBE_RECORD_VERSION, ...record }));
    } catch {
      // A full or blocked store only means the choice is not remembered.
    }
  }

  private remove(tab: string): void {
    try {
      this.storage?.removeItem(PREFIX + tab);
    } catch {
      // Nothing to do: there was nothing the page could keep.
    }
  }
}

/** The store over the browser's local storage, or over nothing when the browser has none. */
export function browserVideoStore(): YoutubeVideoStore {
  try {
    return new YoutubeVideoStore(globalThis.localStorage ?? null);
  } catch {
    return new YoutubeVideoStore(null);
  }
}
