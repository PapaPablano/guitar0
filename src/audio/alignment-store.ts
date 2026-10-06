import { parseAlignmentFile, toAlignmentFile, type AlignmentFile } from './alignment-file';
import type { AlignmentRecord } from './recording-profile';

/** Loads and saves a recording's alignment by content hash. Neither call ever throws. */
export interface AlignmentStore {
  load(hash: string): Promise<AlignmentRecord | null>;
  save(hash: string, record: AlignmentRecord): Promise<void>;
}

/** Where one recording's alignment file lives. `read` returns whatever was stored (read leniently here); `write` replaces it. */
export interface AlignmentFileBackend {
  read(hash: string): Promise<unknown>;
  write(hash: string, file: AlignmentFile): Promise<void>;
}

/**
 * An AlignmentStore over a per-recording file backend. A failed read is "no alignment" and a failed write is a skipped
 * save, never an error the user sees. Saves for one recording run in order, so the last one wins.
 */
export class FileAlignmentStore implements AlignmentStore {
  private queues = new Map<string, Promise<void>>();

  constructor(private readonly backend: AlignmentFileBackend) {}

  async load(hash: string): Promise<AlignmentRecord | null> {
    try {
      return parseAlignmentFile(await this.backend.read(hash), hash);
    } catch {
      return null;
    }
  }

  save(hash: string, record: AlignmentRecord): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await this.backend.write(hash, toAlignmentFile(hash, record));
      } catch {
        // Saved state is a convenience; a failed save must never reach the user.
      }
    };
    const next = (this.queues.get(hash) ?? Promise.resolve()).then(run, run);
    this.queues.set(hash, next);
    void next.then(() => {
      if (this.queues.get(hash) === next) this.queues.delete(hash);
    });
    return next;
  }
}
