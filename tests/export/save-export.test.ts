import { describe, expect, it, vi } from 'vitest';
import { localStamp, saveExport, SLICE_BYTES, type SaveShell } from '../../src/export/save-export';

function fakeShell(overrides: Partial<SaveShell> = {}) {
  const sent: number[] = [];
  const shell: SaveShell = {
    begin: vi.fn(async () => 7),
    append: vi.fn(async (_id, bytes) => {
      sent.push(bytes.length);
    }),
    finish: vi.fn(async () => ({ file_name: 'Song-highway-2026-10-10-1750.mp4', folder: 'C:\Users\p\Videos\Tab Highway' })),
    cancel: vi.fn(async () => undefined),
    ...overrides,
  };
  return { shell, sent };
}

const blobOf = (size: number) => new Blob([new Uint8Array(size)], { type: 'video/mp4' });
const stamp = () => '2026-10-10-1750';

describe('saveExport', () => {
  it('covers AE4: on desktop sends the blob as ordered slices that add up to its size, then finishes', async () => {
    const { shell, sent } = fakeShell();
    const download = vi.fn();
    const size = SLICE_BYTES * 2 + 123;
    const result = await saveExport(blobOf(size), 'Song-highway.mp4', { shell, download, stamp });
    expect(sent).toEqual([SLICE_BYTES, SLICE_BYTES, 123]);
    expect(shell.begin).toHaveBeenCalledWith('Song-highway', '2026-10-10-1750', 'mp4');
    expect(shell.finish).toHaveBeenCalledWith(7);
    expect(download).not.toHaveBeenCalled();
    expect(result).toEqual({ where: 'folder', fileName: 'Song-highway-2026-10-10-1750.mp4', folder: 'C:\Users\p\Videos\Tab Highway' });
  });

  it('sends a blob smaller than one slice in one slice', async () => {
    const { shell, sent } = fakeShell();
    await saveExport(blobOf(10), 'a.wav', { shell, download: vi.fn(), stamp });
    expect(sent).toEqual([10]);
    expect(shell.begin).toHaveBeenCalledWith('a', '2026-10-10-1750', 'wav');
  });

  it('on the website makes no shell call and uses the browser download', async () => {
    const download = vi.fn();
    const result = await saveExport(blobOf(10), 'Song-highway.mp4', { shell: null, download, stamp });
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'Song-highway.mp4');
    expect(result).toEqual({ where: 'download', filename: 'Song-highway.mp4', reason: null });
  });

  it('falls back to the browser download and says why when starting the save fails', async () => {
    const { shell } = fakeShell({ begin: vi.fn(async () => Promise.reject(new Error('no Videos folder'))) });
    const download = vi.fn();
    const result = await saveExport(blobOf(10), 'x.mp4', { shell, download, stamp });
    expect(download).toHaveBeenCalled();
    expect(result).toMatchObject({ where: 'download', reason: expect.stringContaining('no Videos folder') });
    expect(shell.cancel).not.toHaveBeenCalled();
  });

  it('cancels the partial file and falls back when a slice fails partway', async () => {
    let n = 0;
    const { shell } = fakeShell({
      append: vi.fn(async () => {
        if (++n === 2) throw new Error('disk full');
      }),
    });
    const download = vi.fn();
    const result = await saveExport(blobOf(SLICE_BYTES * 3), 'x.mp4', { shell, download, stamp });
    expect(shell.cancel).toHaveBeenCalledWith(7);
    expect(download).toHaveBeenCalled();
    expect(result).toMatchObject({ where: 'download', reason: expect.stringContaining('disk full') });
  });

  it('saves a file name with no extension as it is through the browser path', async () => {
    const download = vi.fn();
    await saveExport(blobOf(1), 'noext', { shell: null, download, stamp });
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'noext');
  });
});

describe('localStamp', () => {
  it('writes the local date and time as YYYY-MM-DD-HHMM', () => {
    expect(localStamp(new Date(2026, 9, 5, 7, 3))).toBe('2026-10-05-0703');
  });
});
