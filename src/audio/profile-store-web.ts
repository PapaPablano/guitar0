import { PROFILE_CAP, FileProfileStore } from './recording-profile';

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
export class WebProfileStore extends FileProfileStore {
  constructor(storage: ProfileStorage | null = defaultProfileStorage(), cap: number = PROFILE_CAP) {
    super(
      {
        // An unreadable or corrupt value reads as an empty file, so the next save replaces it.
        read: async () => {
          try {
            const text = storage?.getItem(PROFILE_STORAGE_KEY);
            return text ? JSON.parse(text) : null;
          } catch {
            return null;
          }
        },
        write: async (file) => {
          if (!storage) throw new Error('browser storage is unavailable');
          storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(file));
        },
      },
      cap,
    );
  }
}
