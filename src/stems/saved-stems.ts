import { invokeShell } from '../app/desktop';

/** Where the hash-to-job index lives. The desktop build keeps it in the shell's data folder. */
export interface StemIndexStore {
  read(): Promise<Record<string, string>>;
  write(index: Record<string, string>): Promise<void>;
}

export const shellStemIndex: StemIndexStore = {
  read: () => invokeShell<Record<string, string>>('stem_index_read'),
  write: (index) => invokeShell<void>('stem_index_write', { index }),
};

/** Maps a recording's content hash to the engine job that holds its stems. */
export class SavedStems {
  constructor(private readonly store: StemIndexStore) {}

  /**
   * The saved job for this hash, or null. An entry whose job no longer exists is removed. Any failure
   * (an unreadable index, an engine that cannot be asked) means "not saved", so separating still works.
   */
  async find(hash: string, jobExists: (jobId: string) => Promise<boolean>): Promise<string | null> {
    try {
      const index = await this.store.read();
      const jobId = index[hash];
      if (!jobId) return null;
      if (await jobExists(jobId)) return jobId;
      delete index[hash];
      await this.store.write(index);
      return null;
    } catch {
      return null;
    }
  }

  /** Like record, but reports failure instead of throwing, so a finished separation is never lost to an index error. */
  async tryRecord(hash: string, jobId: string): Promise<boolean> {
    try {
      await this.record(hash, jobId);
      return true;
    } catch {
      return false;
    }
  }

  /** Call only after a job reports done, so a cancelled or failed run leaves nothing behind. */
  async record(hash: string, jobId: string): Promise<void> {
    const index = await this.store.read();
    index[hash] = jobId;
    await this.store.write(index);
  }
}
