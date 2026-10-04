import {
  PROFILE_CAP,
  findProfile,
  parseProfileFile,
  withProfile,
  type ProfileStore,
  type RecordingProfile,
} from './recording-profile';

export const PROFILE_STORAGE_KEY = 'tab-highway.recording-profiles';

/** The slice of Storage this store uses, so tests pass a fake. */
export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Browser storage, or null when it is unavailable or blocked (accessing it can itself throw). */
export function defaultProfileStorage(): ProfileStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Profiles kept in browser storage as one versioned, capped JSON value. Every access is guarded (R20). */
export class WebProfileStore implements ProfileStore {
  constructor(
    private readonly storage: ProfileStorage | null = defaultProfileStorage(),
    private readonly cap: number = PROFILE_CAP,
  ) {}

  private readFile() {
    const text = this.storage?.getItem(PROFILE_STORAGE_KEY);
    return parseProfileFile(text ? JSON.parse(text) : null);
  }

  async load(hash: string): Promise<RecordingProfile | null> {
    try {
      return findProfile(this.readFile(), hash);
    } catch {
      return null;
    }
  }

  async save(hash: string, profile: RecordingProfile): Promise<void> {
    try {
      if (!this.storage) return;
      let file;
      try {
        file = this.readFile();
      } catch {
        file = parseProfileFile(null);
      }
      this.storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(withProfile(file, hash, profile, this.cap)));
    } catch {
      // Saved state is a convenience; a failed save must never reach the user.
    }
  }
}
