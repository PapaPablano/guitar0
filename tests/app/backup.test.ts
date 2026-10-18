import { describe, expect, it, vi } from 'vitest';
import { backupFailure, backupMessage, createBackup, listBackups, openBackupsFolder, restoreBackup, restoreMessage } from '../../src/app/backup';
import { DesktopUnavailable } from '../../src/app/desktop';

function shell(result: unknown) {
  const invoke = vi.fn().mockResolvedValue(result);
  return { host: { __TAURI__: { core: { invoke } } }, invoke };
}

describe('backup commands', () => {
  it('create sends the local time stamp to the shell', async () => {
    const { host, invoke } = shell({ files: 3, name: 'tab-highway-backup-2026-10-18-1305.zip' });
    const result = await createBackup(host, '2026-10-18-1305');
    expect(invoke).toHaveBeenCalledWith('backup_create', { stamp: '2026-10-18-1305' });
    expect(result.files).toBe(3);
  });

  it('list, restore and open-folder use the shell commands by name', async () => {
    const { host, invoke } = shell(['tab-highway-backup-2026-10-18-1305.zip']);
    await listBackups(host);
    expect(invoke).toHaveBeenLastCalledWith('backup_list', undefined);
    await restoreBackup('tab-highway-backup-2026-10-18-1305.zip', host);
    expect(invoke).toHaveBeenLastCalledWith('backup_restore', { name: 'tab-highway-backup-2026-10-18-1305.zip' });
    await openBackupsFolder(host);
    expect(invoke).toHaveBeenLastCalledWith('backup_open_folder', undefined);
  });

  it('is unavailable on the web', async () => {
    await expect(createBackup({}, '2026-10-18-1305')).rejects.toBeInstanceOf(DesktopUnavailable);
    await expect(listBackups({})).rejects.toBeInstanceOf(DesktopUnavailable);
  });
});

describe('backup wording', () => {
  it('says how many files were saved or restored, in the singular too', () => {
    expect(backupMessage({ files: 1, name: 'a.zip' })).toBe('Saved a.zip with 1 file.');
    expect(backupMessage({ files: 4, name: 'a.zip' })).toBe('Saved a.zip with 4 files.');
    expect(backupMessage({ files: 0, name: 'a.zip' })).toContain('nothing to back up');
    expect(restoreMessage({ files: 2, name: 'a.zip' })).toContain('Restored 2 files from a.zip');
    expect(restoreMessage({ files: 2, name: 'a.zip' })).toContain('Open your songs again');
    expect(restoreMessage({ files: 0, name: 'a.zip' })).toContain('nothing to restore');
  });

  it('shows the shell sentence for a failure, or a general one', () => {
    expect(backupFailure('that file is not a Tab Highway backup')).toBe('that file is not a Tab Highway backup');
    expect(backupFailure(new Error('disk full'))).toBe('disk full');
    expect(backupFailure(undefined)).toBe('That did not work. Try again.');
    expect(backupFailure('   ')).toBe('That did not work. Try again.');
  });
});
