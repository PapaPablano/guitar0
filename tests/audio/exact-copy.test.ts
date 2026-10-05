import { describe, expect, it, vi } from 'vitest';
import { EXACT_COPY_MAX_SECONDS, ExactCopyBuilder, type ExactCopyDeps } from '../../src/audio/exact-copy';
import type { PcmAudio } from '../../src/export/audio';

function pcm(): PcmAudio {
  return { left: new Float32Array([0, 0.5, -0.5]), right: new Float32Array([0, 0.25, -0.25]), sampleRate: 48000 };
}

function file(name: string, type = 'audio/mpeg', bytes = 'a'): File {
  return new File([bytes], name, { type });
}

function deps(overrides: Partial<ExactCopyDeps> = {}) {
  let urls = 0;
  const made: string[] = [];
  const revoked: string[] = [];
  const full: ExactCopyDeps = {
    decode: vi.fn(async () => pcm()),
    encode: vi.fn(() => new Uint8Array([82, 73, 70, 70])),
    hash: vi.fn(async (f: File) => `hash-${f.name}`),
    createUrl: vi.fn(() => {
      const url = `blob:copy-${++urls}`;
      made.push(url);
      return url;
    }),
    revokeUrl: vi.fn((url: string) => {
      revoked.push(url);
    }),
    ...overrides,
  };
  return { full, made, revoked };
}

describe('ExactCopyBuilder', () => {
  it('builds a WAV copy from a decoded recording and leaves the uploaded file untouched', async () => {
    const { full, made } = deps();
    const original = file('song.mp3', 'audio/mpeg', 'original bytes');
    const result = await new ExactCopyBuilder(full).build(original, 120);
    expect(result.kind).toBe('copy');
    if (result.kind === 'copy') expect(result.url).toBe(made[0]);
    expect(full.decode).toHaveBeenCalledWith(original);
    expect(full.encode).toHaveBeenCalledTimes(1);
    expect(await original.text()).toBe('original bytes');
  });

  it('covers R12: the same file built twice decodes once and shares one copy', async () => {
    const { full } = deps();
    const builder = new ExactCopyBuilder(full);
    const a = await builder.build(file('song.mp3'), 120);
    const b = await builder.build(file('song.mp3'), 120);
    expect(full.decode).toHaveBeenCalledTimes(1);
    expect(a.kind === 'copy' && b.kind === 'copy' && a.url === b.url).toBe(true);
  });

  it('keeps a released copy so reopening the same file reuses it', async () => {
    const { full, revoked } = deps();
    const builder = new ExactCopyBuilder(full);
    const first = await builder.build(file('song.mp3'), 120);
    if (first.kind === 'copy') first.release();
    await builder.build(file('song.mp3'), 120);
    expect(full.decode).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([]);
  });

  it('keeps at most two copies and drops the oldest released one when a third arrives', async () => {
    const { full, made, revoked } = deps();
    const builder = new ExactCopyBuilder(full);
    for (const name of ['a.mp3', 'b.mp3']) {
      const r = await builder.build(file(name), 120);
      if (r.kind === 'copy') r.release();
    }
    await builder.build(file('c.mp3'), 120);
    expect(revoked).toEqual([made[0]]);
  });

  it('never drops a copy that is still in use', async () => {
    const { full, revoked } = deps();
    const builder = new ExactCopyBuilder(full);
    await builder.build(file('a.mp3'), 120);
    await builder.build(file('b.mp3'), 120);
    await builder.build(file('c.mp3'), 120);
    expect(revoked).toEqual([]);
  });

  it('skips a file that is already WAV without decoding', async () => {
    const { full } = deps();
    const byType = await new ExactCopyBuilder(full).build(file('x.bin', 'audio/wav'), 120);
    const byName = await new ExactCopyBuilder(full).build(file('x.WAV', ''), 120);
    expect(byType).toEqual({ kind: 'skipped', reason: 'already-wav' });
    expect(byName).toEqual({ kind: 'skipped', reason: 'already-wav' });
    expect(full.decode).not.toHaveBeenCalled();
  });

  it('skips a recording longer than the ceiling without decoding anything', async () => {
    const { full } = deps();
    const result = await new ExactCopyBuilder(full).build(file('long.mp3'), EXACT_COPY_MAX_SECONDS + 1);
    expect(result).toEqual({ kind: 'skipped', reason: 'too-long' });
    expect(full.decode).not.toHaveBeenCalled();
  });

  it('reports failure when the decoder throws and caches nothing', async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error('cannot decode')).mockResolvedValue(pcm());
    const { full } = deps({ decode });
    const builder = new ExactCopyBuilder(full);
    expect(await builder.build(file('bad.mp3'), 120)).toEqual({ kind: 'failed' });
    expect((await builder.build(file('bad.mp3'), 120)).kind).toBe('copy');
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('reports failure when the hash cannot be read', async () => {
    const { full } = deps({ hash: vi.fn().mockRejectedValue(new Error('unreadable')) });
    expect(await new ExactCopyBuilder(full).build(file('x.mp3'), 120)).toEqual({ kind: 'failed' });
  });

  it('release drops the claim, and the last release of an evicted copy does not revoke twice', async () => {
    const { full, revoked } = deps();
    const builder = new ExactCopyBuilder(full, 1);
    const a = await builder.build(file('a.mp3'), 120);
    if (a.kind === 'copy') a.release();
    await builder.build(file('b.mp3'), 120);
    expect(revoked).toHaveLength(1);
    if (a.kind === 'copy') a.release();
    expect(revoked).toHaveLength(1);
  });
});
