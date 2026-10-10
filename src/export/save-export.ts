import { getShell, invokeShell, invokeShellRaw } from '../app/desktop';

/** The size of one slice sent to the shell, so a long video is never one message. */
export const SLICE_BYTES = 4 * 1024 * 1024;

/** The shell's save commands. */
export interface SaveShell {
  begin(name: string, stamp: string, extension: string): Promise<number>;
  append(id: number, bytes: Uint8Array): Promise<void>;
  finish(id: number): Promise<{ file_name: string; folder: string }>;
  cancel(id: number): Promise<void>;
}

export interface SaveEnv {
  /** Null on the website, where there is no shell. */
  shell: SaveShell | null;
  download(blob: Blob, filename: string): void;
  stamp(): string;
}

/** What a save came to: where it went, or that the caller cancelled it first (nothing was saved or downloaded). */
export type SaveOutcome = SaveResult | { where: 'cancelled' };

export type SaveResult =
  | { where: 'folder'; fileName: string; folder: string }
  | { where: 'download'; filename: string; /** Why the folder save was skipped: null on the website, the error on desktop. */ reason: string | null };

/** The local date and time as `YYYY-MM-DD-HHMM`, the stamp the shell puts in a saved file's name. */
export function localStamp(now: Date = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
}

function desktopShell(): SaveShell | null {
  if (!getShell()) return null;
  return {
    begin: (name, stamp, extension) => invokeShell<number>('export_begin', { name, stamp, extension }),
    append: (id, bytes) => invokeShellRaw('export_append', bytes, { 'x-save-id': String(id) }),
    finish: (id) => invokeShell<{ file_name: string; folder: string }>('export_finish', { id }),
    cancel: (id) => invokeShell<void>('export_cancel', { id }),
  };
}

export function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // The click starts the download from the blob URL; free it once the browser has had time to take it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function defaultSaveEnv(): SaveEnv {
  return { shell: desktopShell(), download: browserDownload, stamp: () => localStamp() };
}

/**
 * Saves a finished export. On desktop it goes to the Tab Highway folder under Videos through the shell, in slices; on the
 * website, or if the shell save fails, it is the browser's download. A failure partway removes the partial file first.
 * `isCancelled` is asked before each slice and before the fallback download: once it says yes, a save in progress is removed
 * and nothing more is written or downloaded.
 */
export async function saveExport(blob: Blob, filename: string, env: SaveEnv = defaultSaveEnv(), isCancelled: () => boolean = () => false): Promise<SaveOutcome> {
  const fallback = (reason: string | null): SaveOutcome => {
    if (isCancelled()) return { where: 'cancelled' };
    env.download(blob, filename);
    return { where: 'download', filename, reason };
  };
  if (!env.shell) return fallback(null);
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return fallback('The file has no type to save it as.');
  const shell = env.shell;
  let id: number;
  try {
    id = await shell.begin(filename.slice(0, dot), env.stamp(), filename.slice(dot + 1));
  } catch (e) {
    return fallback(e instanceof Error ? e.message : String(e));
  }
  try {
    for (let start = 0; start < blob.size; start += SLICE_BYTES) {
      if (isCancelled()) {
        await shell.cancel(id).catch(() => undefined);
        return { where: 'cancelled' };
      }
      const slice = new Uint8Array(await blob.slice(start, start + SLICE_BYTES).arrayBuffer());
      await shell.append(id, slice);
    }
    if (isCancelled()) {
      await shell.cancel(id).catch(() => undefined);
      return { where: 'cancelled' };
    }
    const saved = await shell.finish(id);
    return { where: 'folder', fileName: saved.file_name, folder: saved.folder };
  } catch (e) {
    await shell.cancel(id).catch(() => undefined);
    return fallback(e instanceof Error ? e.message : String(e));
  }
}

/** Opens the Tab Highway folder in the file manager (desktop only). */
export function openExportFolder(): Promise<void> {
  return invokeShell<void>('export_open_folder');
}
