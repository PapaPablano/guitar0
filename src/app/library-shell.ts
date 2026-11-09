/**
 * The page's client for the shell's song library commands (src-tauri/src/library.rs): the index, and copying tab and
 * recording files in and out. Files go to the shell in 4 MB raw slices and come back in chunks. Every failure reports
 * "not saved" or "missing" (null) instead of throwing.
 */

import { SLICE_BYTES } from '../export/save-export';
import { hashFile } from '../stems/file-hash';
import { getShell, invokeShell, invokeShellBytes, invokeShellRaw } from './desktop';
import type { LibraryBackend, LibraryIndex, RecordingRef } from './library';

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
  };
}

/** SHA-256 of some bytes as lowercase hex: the same hash `hashFile` gives a File with these bytes. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The extension a recording is stored under: its own, lowercased, when the shell accepts it, otherwise `bin`. */
export function recordingExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return 'bin';
  const extension = fileName.slice(dot + 1).toLowerCase();
  return RECORDING_EXTENSIONS.has(extension) ? extension : 'bin';
}

/**
 * Copies the bytes into the library under their hash, unless it already holds them. True once the file is stored. A failure
 * partway cancels the write, so the shell removes the partial file and nothing points at it.
 */
async function store(shell: LibraryShell, kind: LibraryKind, hash: string, extension: string, data: Blob): Promise<boolean> {
  // A failed check is not a reason to skip the copy; the shell keeps one file per hash either way.
  if (await shell.exists(kind, hash, extension).catch(() => false)) return true;
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
export async function saveRecording(shell: LibraryShell, file: File): Promise<RecordingRef | null> {
  try {
    const hash = await hashFile(file);
    const extension = recordingExtension(file.name);
    if (!(await store(shell, 'recording', hash, extension, file))) return null;
    return { hash, name: file.name, type: file.type, extension };
  } catch {
    return null;
  }
}

/** Copies a tab file's bytes into the library. Their hash (the song's identity), or null when not saved. */
export async function saveTab(shell: LibraryShell, bytes: Uint8Array): Promise<string | null> {
  try {
    const hash = await hashBytes(bytes);
    return (await store(shell, 'tab', hash, TAB_EXTENSION, new Blob([bytes as BlobPart]))) ? hash : null;
  } catch {
    return null;
  }
}

/**
 * Rebuilds a stored recording as a File with its saved name and type, or null when it is missing, unreadable or no longer
 * matches its hash. The check hashes through `hashFile`, so the app's later hash of this File is already known.
 */
export async function readRecording(shell: LibraryShell, ref: RecordingRef): Promise<File | null> {
  const blob = await load(shell, 'recording', ref.hash, ref.extension);
  if (!blob) return null;
  const file = new File([blob], ref.name, { type: ref.type });
  try {
    return (await hashFile(file)) === ref.hash ? file : null;
  } catch {
    return null;
  }
}

/** A stored tab's bytes, or null when missing, unreadable or no longer matching its hash. */
export async function readTab(shell: LibraryShell, tabHash: string): Promise<Uint8Array | null> {
  const blob = await load(shell, 'tab', tabHash, TAB_EXTENSION);
  if (!blob) return null;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return (await hashBytes(bytes)) === tabHash ? bytes : null;
  } catch {
    return null;
  }
}
