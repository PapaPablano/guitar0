/**
 * The page's client for the shell's song library commands (src-tauri/src/library.rs): the index, and copying tab and
 * recording files in and out, deleting them, and checking they are there. Files go to the shell in 4 MB raw slices and
 * come back in chunks. Every failure reports "not saved", "missing" or "failed" instead of throwing.
 */

import { SLICE_BYTES } from '../export/save-export';
import { hashFile, sha256Hex } from '../stems/file-hash';
import { getShell, invokeShell, invokeShellBytes, invokeShellRaw } from './desktop';
import type { LibraryBackend, LibraryEntry, LibraryIndex, RecordingRef } from './library';

export type LibraryKind = 'tab' | 'recording';

/** The shell's library file commands. */
export interface LibraryShell {
  begin(kind: LibraryKind, hash: string, extension: string): Promise<number>;
  append(id: number, bytes: Uint8Array): Promise<void>;
  /** True when the file is newly stored, false when the library already had it. Rejects when the bytes do not match the hash. */
  finish(id: number): Promise<boolean>;
  cancel(id: number): Promise<void>;
  /** Up to `len` bytes from `offset` (the shell caps one read at 16 MB); empty past the end. Rejects when the file is missing. */
  read(kind: LibraryKind, hash: string, extension: string, offset: number, len: number): Promise<Uint8Array>;
  exists(kind: LibraryKind, hash: string, extension: string): Promise<boolean>;
  /**
   * True when the file is deleted or was already missing; false when the shell refused because a write to the same file
   * is open (KTD3, R13). Rejects on a bad name or a failed delete.
   */
  delete(kind: LibraryKind, hash: string, extension: string): Promise<boolean>;
}

/** A stored file read back: its contents, or why it can't be used (KTD7). */
export type StoredRead<T> =
  | { kind: 'ok'; value: T }
  /** The file is not there, or could not be read. */
  | { kind: 'missing' }
  /** The bytes were read but no longer match their hash. */
  | { kind: 'damaged' };

/** How a stored file's delete went. */
export type DeleteResult = 'deleted' | 'in-use' | 'failed';

/** A song's stored files as the list sees them at load (KTD7). `recording` is null when the song has none. */
export interface FileCheck {
  tab: 'ok' | 'missing';
  recording: 'ok' | 'missing' | null;
}

export interface StoreOptions {
  /**
   * True for a hash whose existing copy must be replaced, such as one found damaged this session (KTD6): the copy skips
   * the "already stored" shortcut and goes through the shell's finish, which replaces a damaged target. Called with the
   * file's hash; a rejection counts as true.
   */
  forceCopy?: (hash: string) => boolean | Promise<boolean>;
}

/** The largest read the shell answers in one call. */
export const READ_CHUNK_BYTES = 16 * 1024 * 1024;

/** The stored extension for every tab. */
export const TAB_EXTENSION = 'bin';

/** Recording extensions the shell accepts; anything else is stored as `bin`. Must match library.rs. */
const RECORDING_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'webm', 'bin']);

/** The index in the shell's data folder. */
export function shellLibraryBackend(host: object = globalThis): LibraryBackend {
  return {
    read: () => invokeShell<{ index: LibraryIndex; quarantined: boolean }>('library_index_read', undefined, host),
    write: (index) => invokeShell<void>('library_index_write', { index }, host),
  };
}

/** The library file commands, or null on the web. */
export function desktopLibraryShell(host: object = globalThis): LibraryShell | null {
  if (!getShell(host)) return null;
  return {
    begin: (kind, hash, extension) => invokeShell<number>('library_write_begin', { kind, hash, extension }, host),
    append: (id, bytes) => invokeShellRaw('library_write_append', bytes, { 'x-save-id': String(id) }, host),
    finish: (id) => invokeShell<boolean>('library_write_finish', { id }, host),
    cancel: (id) => invokeShell<void>('library_write_cancel', { id }, host),
    read: (kind, hash, extension, offset, len) => invokeShellBytes('library_read', { kind, hash, extension, offset, len }, host),
    exists: (kind, hash, extension) => invokeShell<boolean>('library_exists', { kind, hash, extension }, host),
    delete: (kind, hash, extension) => invokeShell<boolean>('library_delete', { kind, hash, extension }, host),
  };
}

/** SHA-256 of some bytes as lowercase hex: the same hash `hashFile` gives a File with these bytes. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes as BufferSource);
}

/** The extension a recording is stored under: its own, lowercased, when the shell accepts it, otherwise `bin`. */
export function recordingExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return 'bin';
  const extension = fileName.slice(dot + 1).toLowerCase();
  return RECORDING_EXTENSIONS.has(extension) ? extension : 'bin';
}

/** Whether the copy must skip the "already stored" shortcut. A failed answer copies; the shell keeps one file per hash. */
async function mustCopy(options: StoreOptions, hash: string): Promise<boolean> {
  if (!options.forceCopy) return false;
  try {
    return await options.forceCopy(hash);
  } catch {
    return true;
  }
}

/**
 * Copies the bytes into the library under their hash, unless it already holds them and `forceCopy` does not ask for a
 * fresh copy. True once the file is stored. A failure partway cancels the write, so the shell removes the partial file
 * and nothing points at it.
 */
async function store(shell: LibraryShell, kind: LibraryKind, hash: string, extension: string, data: Blob, options: StoreOptions): Promise<boolean> {
  // A failed check is not a reason to skip the copy; the shell keeps one file per hash either way.
  if (!(await mustCopy(options, hash)) && (await shell.exists(kind, hash, extension).catch(() => false))) return true;
  let id: number;
  try {
    id = await shell.begin(kind, hash, extension);
  } catch {
    return false;
  }
  try {
    for (let start = 0; start < data.size; start += SLICE_BYTES) {
      await shell.append(id, new Uint8Array(await data.slice(start, start + SLICE_BYTES).arrayBuffer()));
    }
    await shell.finish(id);
    return true;
  } catch {
    await shell.cancel(id).catch(() => undefined);
    return false;
  }
}

/** Reads a stored file whole, or null when it is missing or cannot be read. */
async function load(shell: LibraryShell, kind: LibraryKind, hash: string, extension: string): Promise<Blob | null> {
  try {
    const parts: Uint8Array[] = [];
    for (let offset = 0; ; ) {
      const chunk = await shell.read(kind, hash, extension, offset, READ_CHUNK_BYTES);
      if (chunk.byteLength === 0) break;
      parts.push(chunk);
      offset += chunk.byteLength;
    }
    return new Blob(parts as BlobPart[]);
  } catch {
    return null;
  }
}

/** Copies a recording into the library. Its reference, or null when it was not saved; the player's file is not changed. */
export async function saveRecording(shell: LibraryShell, file: File, options: StoreOptions = {}): Promise<RecordingRef | null> {
  try {
    const hash = await hashFile(file);
    const extension = recordingExtension(file.name);
    if (!(await store(shell, 'recording', hash, extension, file, options))) return null;
    return { hash, name: file.name, type: file.type, extension };
  } catch {
    return null;
  }
}

/** Copies a tab file's bytes into the library. Their hash (the song's identity), or null when not saved. */
export async function saveTab(shell: LibraryShell, bytes: Uint8Array, options: StoreOptions = {}): Promise<string | null> {
  try {
    const hash = await hashBytes(bytes);
    return (await store(shell, 'tab', hash, TAB_EXTENSION, new Blob([bytes as BlobPart]), options)) ? hash : null;
  } catch {
    return null;
  }
}

/**
 * Rebuilds a stored recording as a File with its saved name and type. Missing when it is not there or cannot be read,
 * damaged when its bytes no longer match its hash. The check hashes through `hashFile`, so the app's later hash of this
 * File is already known.
 */
export async function readRecording(shell: LibraryShell, ref: RecordingRef): Promise<StoredRead<File>> {
  const blob = await load(shell, 'recording', ref.hash, ref.extension);
  if (!blob) return { kind: 'missing' };
  const file = new File([blob], ref.name, { type: ref.type });
  try {
    return (await hashFile(file)) === ref.hash ? { kind: 'ok', value: file } : { kind: 'damaged' };
  } catch {
    return { kind: 'missing' };
  }
}

/** A stored tab's bytes. Missing when not there or unreadable, damaged when they no longer match their hash. */
export async function readTab(shell: LibraryShell, tabHash: string): Promise<StoredRead<Uint8Array>> {
  const blob = await load(shell, 'tab', tabHash, TAB_EXTENSION);
  if (!blob) return { kind: 'missing' };
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return (await hashBytes(bytes)) === tabHash ? { kind: 'ok', value: bytes } : { kind: 'damaged' };
  } catch {
    return { kind: 'missing' };
  }
}

/**
 * Deletes a stored file (KTD3). In-use when the shell kept it because a write to it is open (R13); failed when the
 * shell rejected. Either way the file stays, and the startup sweep removes it once nothing names it.
 */
export async function deleteFile(shell: LibraryShell, kind: LibraryKind, hash: string, extension: string): Promise<DeleteResult> {
  try {
    return (await shell.delete(kind, hash, extension)) ? 'deleted' : 'in-use';
  } catch {
    return 'failed';
  }
}

/**
 * Whether a song's stored tab and recording are there, asked in parallel with the cheap exists check (KTD7). A check
 * that fails reads as present, so a passing problem never marks a song missing.
 */
export async function checkFiles(shell: LibraryShell, entry: Pick<LibraryEntry, 'tabHash' | 'recording'>): Promise<FileCheck> {
  const present = (kind: LibraryKind, hash: string, extension: string) => shell.exists(kind, hash, extension).catch(() => true);
  const recording = entry.recording;
  const [tab, stored] = await Promise.all([
    present('tab', entry.tabHash, TAB_EXTENSION),
    recording ? present('recording', recording.hash, recording.extension) : Promise.resolve(null),
  ]);
  return { tab: tab ? 'ok' : 'missing', recording: stored === null ? null : stored ? 'ok' : 'missing' };
}
