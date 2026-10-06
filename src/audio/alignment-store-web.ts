import { FileAlignmentStore } from './alignment-store';
import { defaultProfileStorage, type ProfileStorage } from './profile-store-web';

export const ALIGNMENT_STORAGE_PREFIX = 'tab-highway.alignment.';

/**
 * Alignments kept in browser storage, one value per recording. The web build has no file to edit, but it gets the same
 * checks and the same report when the tab has changed. Every access is guarded.
 */
export class WebAlignmentStore extends FileAlignmentStore {
  constructor(storage: ProfileStorage | null = defaultProfileStorage()) {
    super({
      // An unreadable or corrupt value reads as no alignment, so the next save replaces it.
      read: async (hash) => {
        try {
          const text = storage?.getItem(ALIGNMENT_STORAGE_PREFIX + hash);
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      },
      write: async (hash, file) => {
        if (!storage) throw new Error('browser storage is unavailable');
        storage.setItem(ALIGNMENT_STORAGE_PREFIX + hash, JSON.stringify(file));
      },
    });
  }
}
