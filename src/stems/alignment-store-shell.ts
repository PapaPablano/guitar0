import { invokeShell } from '../app/desktop';
import { FileAlignmentStore, type AlignmentFileBackend } from '../audio/alignment-store';

/**
 * The desktop shell keeps one readable file per recording in data/alignments, named by the recording's content hash.
 * The player can open and edit it; the app reads those edits when the recording is opened.
 */
export const shellAlignmentBackend: AlignmentFileBackend = {
  read: (hash) => invokeShell<unknown>('alignment_read', { hash }),
  write: (hash, alignment) => invokeShell<void>('alignment_write', { hash, alignment }),
};

export const shellAlignmentStore = new FileAlignmentStore(shellAlignmentBackend);
