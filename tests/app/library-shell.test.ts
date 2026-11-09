import { describe, expect, it, vi } from 'vitest';
import {
  desktopLibraryShell,
  hashBytes,
  readRecording,
  readTab,
  recordingExtension,
  saveRecording,
  saveTab,
  shellLibraryBackend,
  type LibraryShell,
} from '../../src/app/library-shell';
import { hashFile } from '../../src/stems/file-hash';

const MB = 1024 * 1024;

/** A shell that keeps stored files in memory and logs every call. */
function fakeShell(options: { failAppendAt?: number; failFinish?: boolean; chunk?: number } = {}) {
  const stored = new Map<string, Uint8Array>();
  const pending = new Map<number, { key: string; parts: Uint8Array[] }>();
  const calls: string[] = [];
  const appended: number[] = [];
  let next = 1;
  let appends = 0;
  const key = (kind: string, hash: string, extension: string) => `${kind}/${hash}.${extension}`;
  const shell: LibraryShell = {
    async begin(kind, hash, extension) {
      calls.push(`begin ${kind} ${extension}`);
      const id = next++;
      pending.set(id, { key: key(kind, hash, extension), parts: [] });
      return id;
    },
    async append(id, bytes) {
      calls.push('append');
      appends += 1;
      if (options.failAppendAt === appends) throw new Error('disk full');
      appended.push(bytes.byteLength);
      pending.get(id)!.parts.push(bytes.slice());
    },
    async finish(id) {
      calls.push('finish');
      const write = pending.get(id)!;
      pending.delete(id);
      if (options.failFinish) throw new Error('hash mismatch');
      const fresh = !stored.has(write.key);
      stored.set(write.key, new Uint8Array(await new Blob(write.parts as BlobPart[]).arrayBuffer()));
      return fresh;
    },
    async cancel(id) {
      calls.push('cancel');
      pending.delete(id);
    },
    async read(kind, hash, extension, offset, len) {
      calls.push('read');
      const file = stored.get(key(kind, hash, extension));
      if (!file) throw new Error('missing');
      const take = Math.min(len, options.chunk ?? 16 * MB);
      return file.slice(offset, offset + take);
    },
    async exists(kind, hash, extension) {
      calls.push('exists');
      return stored.has(key(kind, hash, extension));
    },
  };
  return { shell, stored, calls, appended, key };
}

/** Compares large byte arrays quickly; a deep equal walks every element. */
const sameBytes = (a: Uint8Array | undefined, b: Uint8Array) => !!a && Buffer.from(a).equals(Buffer.from(b));

function bytesOf(size: number, seed = 1): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

describe('hashBytes', () => {
  it('is the sha256 of the bytes as lowercase hex, the same hash the recording stores use', async () => {
    expect(await hashBytes(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const bytes = bytesOf(1000);
    expect(await hashBytes(bytes)).toBe(await hashFile(new File([bytes as BlobPart], 'x.mp3')));
  });
});

describe('recordingExtension', () => {
  it('lowercases an allowed extension and falls back to bin', () => {
    expect(recordingExtension('Take.MP3')).toBe('mp3');
    expect(recordingExtension('take.flac')).toBe('flac');
    expect(recordingExtension('take.exe')).toBe('bin');
    expect(recordingExtension('take')).toBe('bin');
    expect(recordingExtension('.mp3')).toBe('bin');
    expect(recordingExtension('')).toBe('bin');
  });
});

describe('saveRecording', () => {
  it('sends a 9 MB file as three raw slices in order, then finish, and returns its reference', async () => {
    const fake = fakeShell();
    const bytes = bytesOf(9 * MB);
    const file = new File([bytes as BlobPart], 'Take.WAV', { type: 'audio/wav' });
    const ref = await saveRecording(fake.shell, file);
    const hash = await hashFile(file);
    expect(ref).toEqual({ hash, name: 'Take.WAV', type: 'audio/wav', extension: 'wav' });
    expect(fake.calls).toEqual(['exists', 'begin recording wav', 'append', 'append', 'append', 'finish']);
    expect(fake.appended).toEqual([4 * MB, 4 * MB, 1 * MB]);
    expect(sameBytes(fake.stored.get(fake.key('recording', hash, 'wav')), bytes)).toBe(true);
  });

  it('covers R3: a recording already in the library is not copied again', async () => {
    const fake = fakeShell();
    const file = new File([bytesOf(100) as BlobPart], 'a.mp3', { type: 'audio/mpeg' });
    await saveRecording(fake.shell, file);
    fake.calls.length = 0;
    const again = await saveRecording(fake.shell, new File([bytesOf(100) as BlobPart], 'renamed.mp3', { type: 'audio/mpeg' }));
    expect(again?.name).toBe('renamed.mp3');
    expect(fake.calls).toEqual(['exists']);
  });

  it('a failing append cancels the write and reports failure', async () => {
    const fake = fakeShell({ failAppendAt: 2 });
    const file = new File([bytesOf(9 * MB) as BlobPart], 'a.mp3', { type: 'audio/mpeg' });
    expect(await saveRecording(fake.shell, file)).toBeNull();
    expect(fake.calls).toEqual(['exists', 'begin recording mp3', 'append', 'append', 'cancel']);
    expect(fake.stored.size).toBe(0);
  });

  it('a failing finish (the shell found a hash mismatch) reports failure', async () => {
    const fake = fakeShell({ failFinish: true });
    const file = new File([bytesOf(10) as BlobPart], 'a.mp3');
    expect(await saveRecording(fake.shell, file)).toBeNull();
    expect(fake.calls.at(-1)).toBe('cancel');
  });

  it('reports failure when begin is refused', async () => {
    const fake = fakeShell();
    fake.shell.begin = async () => {
      throw new Error('not a content hash');
    };
    expect(await saveRecording(fake.shell, new File([bytesOf(10) as BlobPart], 'a.mp3'))).toBeNull();
    expect(fake.calls).not.toContain('cancel');
  });

  it('still copies when the exists check fails', async () => {
    const fake = fakeShell();
    fake.shell.exists = async () => {
      throw new Error('locked');
    };
    expect(await saveRecording(fake.shell, new File([bytesOf(10) as BlobPart], 'a.ogg'))).not.toBeNull();
    expect(fake.calls).toContain('finish');
  });

  it('copies an empty file as begin then finish', async () => {
    const fake = fakeShell();
    expect(await saveRecording(fake.shell, new File([], 'empty.mp3'))).not.toBeNull();
    expect(fake.calls).toEqual(['exists', 'begin recording mp3', 'finish']);
  });
});

describe('saveTab', () => {
  it('stores the tab bytes under their sha256 with the bin extension', async () => {
    const fake = fakeShell();
    const bytes = bytesOf(5000, 7);
    const hash = await saveTab(fake.shell, bytes);
    expect(hash).toBe(await hashBytes(bytes));
    expect(fake.stored.get(fake.key('tab', hash!, 'bin'))).toEqual(bytes);
  });

  it('reports failure instead of throwing', async () => {
    const fake = fakeShell({ failAppendAt: 1 });
    expect(await saveTab(fake.shell, bytesOf(10))).toBeNull();
  });
});

describe('reading back', () => {
  it('joins chunks into a File with the stored name and type, whose hash equals the stored hash', async () => {
    const fake = fakeShell({ chunk: 3 * MB });
    const bytes = bytesOf(7 * MB + 5);
    const ref = await saveRecording(fake.shell, new File([bytes as BlobPart], 'Song.m4a', { type: 'audio/mp4' }));
    fake.calls.length = 0;
    const file = await readRecording(fake.shell, ref!);
    expect(file).not.toBeNull();
    expect(file!.name).toBe('Song.m4a');
    expect(file!.type).toBe('audio/mp4');
    expect(sameBytes(new Uint8Array(await file!.arrayBuffer()), bytes)).toBe(true);
    expect(await hashFile(file!)).toBe(ref!.hash);
    expect(fake.calls.filter((c) => c === 'read').length).toBeGreaterThanOrEqual(3);
  });

  it('reads a missing recording as null', async () => {
    const fake = fakeShell();
    expect(await readRecording(fake.shell, { hash: 'a'.repeat(64), name: 'x.mp3', type: 'audio/mpeg', extension: 'mp3' })).toBeNull();
  });

  it('reads a recording whose bytes no longer match its hash as null', async () => {
    const fake = fakeShell();
    const ref = await saveRecording(fake.shell, new File([bytesOf(100) as BlobPart], 'x.mp3'));
    fake.stored.set(fake.key('recording', ref!.hash, 'mp3'), bytesOf(100, 9));
    expect(await readRecording(fake.shell, ref!)).toBeNull();
  });

  it('reads a stored tab back as its bytes, or null when missing', async () => {
    const fake = fakeShell();
    const bytes = bytesOf(2000, 3);
    const hash = await saveTab(fake.shell, bytes);
    expect(await readTab(fake.shell, hash!)).toEqual(bytes);
    expect(await readTab(fake.shell, 'b'.repeat(64))).toBeNull();
  });
});

describe('desktop wiring', () => {
  it('has no library shell on the web', () => {
    expect(desktopLibraryShell({})).toBeNull();
  });

  it('calls the library commands with camelCase arguments and the save-id header', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'library_write_begin') return 9;
      if (command === 'library_write_finish') return true;
      if (command === 'library_read') return new Uint8Array([1, 2]).buffer;
      if (command === 'library_exists') return false;
      return null;
    });
    const shell = desktopLibraryShell({ __TAURI__: { core: { invoke } } })!;
    const hash = 'c'.repeat(64);
    expect(await shell.begin('recording', hash, 'mp3')).toBe(9);
    const bytes = new Uint8Array([5]);
    await shell.append(9, bytes);
    expect(await shell.finish(9)).toBe(true);
    await shell.cancel(9);
    expect(await shell.read('tab', hash, 'bin', 0, 10)).toEqual(new Uint8Array([1, 2]));
    expect(await shell.exists('tab', hash, 'bin')).toBe(false);
    expect(invoke.mock.calls).toEqual([
      ['library_write_begin', { kind: 'recording', hash, extension: 'mp3' }],
      ['library_write_append', bytes, { headers: { 'x-save-id': '9' } }],
      ['library_write_finish', { id: 9 }],
      ['library_write_cancel', { id: 9 }],
      ['library_read', { kind: 'tab', hash, extension: 'bin', offset: 0, len: 10 }],
      ['library_exists', { kind: 'tab', hash, extension: 'bin' }],
    ]);
  });

  it('reads and writes the index through the shell', async () => {
    const index = { version: 1, entries: [] };
    const invoke = vi.fn(async (command: string) => (command === 'library_index_read' ? { index, quarantined: true } : null));
    const backend = shellLibraryBackend({ __TAURI__: { core: { invoke } } });
    expect(await backend.read()).toEqual({ index, quarantined: true });
    await backend.write({ version: 1, entries: [] });
    expect(invoke).toHaveBeenLastCalledWith('library_index_write', { index: { version: 1, entries: [] } });
  });
});
