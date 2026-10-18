import { useCallback, useEffect, useRef, useState } from 'react';
import { backupFailure, backupMessage, createBackup, listBackups, openBackupsFolder, restoreBackup, restoreMessage } from './backup';

interface BackupDialogProps {
  onClose: () => void;
}

/** Back up and restore the player's practice data (desktop only). Stem audio is not included; it can be made again. */
export function BackupDialog({ onClose }: BackupDialogProps) {
  const [backups, setBackups] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    listBackups().then(setBackups, () => setBackups([]));
  }, []);
  useEffect(() => {
    refresh();
    close.current?.focus();
  }, [refresh]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setFailed(false);
    try {
      setMessage(await action());
    } catch (e) {
      setFailed(true);
      setMessage(backupFailure(e));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <div className="overlay">
      <section className="dialog" role="dialog" aria-modal="true" aria-label="Back up and restore">
        <h2>Back up and restore</h2>
        <p className="muted">
          A backup keeps your saved recording settings, alignments and list of saved stems. It does not include the stem audio itself, which can be made again, or your Pro status.
        </p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void run(async () => backupMessage(await createBackup()))}>
            Back up now
          </button>
          <button type="button" onClick={() => void openBackupsFolder().catch(() => {})}>
            Open backups folder
          </button>
        </div>
        <h3>Restore</h3>
        {backups === null && <p className="muted">Looking for backups…</p>}
        {backups !== null && backups.length === 0 && <p className="muted">No backups yet. Back up now, or put a backup file in the backups folder.</p>}
        {backups !== null && backups.length > 0 && (
          <ul className="backup-list">
            {backups.map((name) => (
              <li key={name}>
                <span>{name}</span>{' '}
                <button type="button" disabled={busy} onClick={() => void run(async () => restoreMessage(await restoreBackup(name)))}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
        {message && (
          <p role={failed ? 'alert' : 'status'} className={failed ? 'error' : undefined}>
            {message}
          </p>
        )}
        <div className="actions">
          <button type="button" ref={close} onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
