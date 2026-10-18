import { invokeShell } from './desktop';
import { localStamp } from '../export/save-export';

/** What the shell reports after a backup or restore. */
export interface BackupSummary {
  readonly files: number;
  readonly name: string;
}

/** Writes a backup of the player's profiles, alignments and saved-stems index into the Backups folder. */
export function createBackup(host: object = globalThis, stamp: string = localStamp()): Promise<BackupSummary> {
  return invokeShell<BackupSummary>('backup_create', { stamp }, host);
}

/** The backups in the Backups folder, newest first. */
export function listBackups(host: object = globalThis): Promise<string[]> {
  return invokeShell<string[]>('backup_list', undefined, host);
}

/** Restores one of the listed backups by name; the shell refuses any other name. */
export function restoreBackup(name: string, host: object = globalThis): Promise<BackupSummary> {
  return invokeShell<BackupSummary>('backup_restore', { name }, host);
}

export function openBackupsFolder(host: object = globalThis): Promise<void> {
  return invokeShell<void>('backup_open_folder', undefined, host);
}

/** One plain sentence for the result of a backup. */
export function backupMessage(summary: BackupSummary): string {
  return summary.files === 0
    ? `Saved ${summary.name}, but there was nothing to back up yet.`
    : `Saved ${summary.name} with ${summary.files} ${summary.files === 1 ? 'file' : 'files'}.`;
}

/** One plain sentence for the result of a restore. Songs already open keep their old settings until they are opened again. */
export function restoreMessage(summary: BackupSummary): string {
  return summary.files === 0
    ? `${summary.name} had nothing to restore.`
    : `Restored ${summary.files} ${summary.files === 1 ? 'file' : 'files'} from ${summary.name}. Open your songs again to use them.`;
}

/** The text to show for a failed backup action: the shell's own sentence, or a general one. */
export function backupFailure(error: unknown): string {
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return text.trim() || 'That did not work. Try again.';
}
