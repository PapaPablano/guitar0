import { STEM_NAMES } from '../stems/engine-client';
import { AlignmentMap, type Hold } from './alignment-map';
import type { MixState } from './mix-gains';
import { clampOffset } from './offset-range';

/** Bumped when the stored shape changes; a file or entry with any other version reads as "no profile". */
export const PROFILE_VERSION = 1;

/** Most recordings remembered; the oldest entry is dropped first. */
export const PROFILE_CAP = 200;

/**
 * How the recording was lined up with the tab beyond its base offset. A record means the recording was analysed
 * (`auto`) or the user reverted to a single offset (`manual`); a profile without one was set by hand, which is
 * also what every profile saved before alignment existed is.
 */
export interface AlignmentRecord {
  source: 'auto' | 'manual';
  /** Extra playing: tab time on a bar line and how long the tab waits there. */
  holds: readonly Hold[];
}

/** What is remembered per recording. There is deliberately no loop or tempo field (R19). */
export interface RecordingProfile {
  version: number;
  /** Seconds the user shifted the recording against the tab: the base offset of the alignment. */
  offset: number;
  /** Per-stem volume, mute and solo. Present only when stems were in use. */
  mix?: MixState;
  alignment?: AlignmentRecord;
}

/** Loads and saves a recording's profile by content hash. Neither call ever throws (R20). */
export interface ProfileStore {
  load(hash: string): Promise<RecordingProfile | null>;
  save(hash: string, profile: RecordingProfile): Promise<void>;
}

interface ProfileEntry {
  hash: string;
  profile: RecordingProfile;
}

/** The persisted shape. Entries are an ordered list, oldest first, because object key order is not reliable across stores. */
export interface ProfileFile {
  version: number;
  entries: ProfileEntry[];
}

export const emptyProfileFile = (): ProfileFile => ({ version: PROFILE_VERSION, entries: [] });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function normalizeMix(raw: unknown): MixState | undefined {
  if (!isRecord(raw)) return undefined;
  const mix = {} as MixState;
  for (const name of STEM_NAMES) {
    const s = raw[name];
    if (!isRecord(s) || typeof s.volume !== 'number' || !Number.isFinite(s.volume) || typeof s.muted !== 'boolean' || typeof s.solo !== 'boolean') {
      return undefined;
    }
    mix[name] = { volume: s.volume, muted: s.muted, solo: s.solo };
  }
  return mix;
}

function normalizeAlignment(raw: unknown, offset: number): AlignmentRecord | undefined {
  if (!isRecord(raw) || (raw.source !== 'auto' && raw.source !== 'manual')) return undefined;
  const map = AlignmentMap.normalize({ base: offset, holds: raw.holds });
  return map ? { source: raw.source, holds: map.holds } : undefined;
}

/** A trusted profile from untrusted stored data: unknown version or bad offset is null; offset is clamped; a bad mix or alignment record is dropped. */
export function normalizeProfile(raw: unknown): RecordingProfile | null {
  if (!isRecord(raw) || raw.version !== PROFILE_VERSION) return null;
  if (typeof raw.offset !== 'number' || !Number.isFinite(raw.offset)) return null;
  const offset = clampOffset(raw.offset);
  const mix = normalizeMix(raw.mix);
  const alignment = normalizeAlignment(raw.alignment, offset);
  return { version: PROFILE_VERSION, offset, ...(mix ? { mix } : {}), ...(alignment ? { alignment } : {}) };
}

/** Reads untrusted stored data as a profile file. Anything unrecognised, or a different file version, is empty. */
export function parseProfileFile(raw: unknown): ProfileFile {
  if (!isRecord(raw) || raw.version !== PROFILE_VERSION || !Array.isArray(raw.entries)) return emptyProfileFile();
  const entries: ProfileEntry[] = [];
  for (const e of raw.entries) {
    if (!isRecord(e) || typeof e.hash !== 'string') continue;
    const profile = normalizeProfile(e.profile);
    if (profile) entries.push({ hash: e.hash, profile });
  }
  return { version: PROFILE_VERSION, entries };
}

export function findProfile(file: ProfileFile, hash: string): RecordingProfile | null {
  return file.entries.find((e) => e.hash === hash)?.profile ?? null;
}

/** A new file with this profile as the newest entry (replacing any earlier one for the hash), trimmed oldest-first to the cap. */
export function withProfile(file: ProfileFile, hash: string, profile: RecordingProfile, cap: number = PROFILE_CAP): ProfileFile {
  const entries = file.entries.filter((e) => e.hash !== hash);
  entries.push({ hash, profile });
  return { version: PROFILE_VERSION, entries: entries.slice(Math.max(0, entries.length - cap)) };
}

/** Where a whole profile file lives. read returns whatever was stored (parsed leniently here); write replaces it. */
export interface ProfileFileBackend {
  read(): Promise<unknown>;
  write(file: ProfileFile): Promise<void>;
}

/** A ProfileStore over a whole-file backend (the desktop shell). Every failure is "no profile" or a skipped save. */
export class FileProfileStore implements ProfileStore {
  constructor(
    private readonly backend: ProfileFileBackend,
    private readonly cap: number = PROFILE_CAP,
  ) {}

  async load(hash: string): Promise<RecordingProfile | null> {
    try {
      return findProfile(parseProfileFile(await this.backend.read()), hash);
    } catch {
      return null;
    }
  }

  async save(hash: string, profile: RecordingProfile): Promise<void> {
    try {
      const file = parseProfileFile(await this.backend.read());
      await this.backend.write(withProfile(file, hash, profile, this.cap));
    } catch {
      // Saved state is a convenience; a failed save must never reach the user.
    }
  }
}
