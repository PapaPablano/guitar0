import { describe, expect, it } from 'vitest';
import { hashFile } from '../../src/stems/file-hash';

describe('hashFile', () => {
  it('is SHA-256 hex of the bytes, independent of the name', async () => {
    const a = await hashFile(new File(['abc'], 'a.mp3'));
    const b = await hashFile(new File(['abc'], 'b.mp3'));
    expect(a).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(b).toBe(a);
  });
  it('reads a given File once and shares the result', async () => {
    let reads = 0;
    const f = new File(['abc'], 'a.mp3');
    const orig = f.arrayBuffer.bind(f);
    f.arrayBuffer = () => (reads++, orig());
    const [x, y] = await Promise.all([hashFile(f), hashFile(f)]);
    await hashFile(f);
    expect(x).toBe(y);
    expect(reads).toBe(1);
  });
  it('does not cache a failure', async () => {
    let fail = true;
    const f = new File(['abc'], 'a.mp3');
    const orig = f.arrayBuffer.bind(f);
    f.arrayBuffer = () => (fail ? Promise.reject(new Error('read')) : orig());
    await expect(hashFile(f)).rejects.toThrow();
    fail = false;
    await expect(hashFile(f)).resolves.toHaveLength(64);
  });
});

import { hashVideoLink } from '../../src/stems/file-hash';

describe('hashVideoLink', () => {
  it('is 64 lowercase hex characters, the key shape the desktop alignment store requires', async () => {
    expect(await hashVideoLink('https://www.youtube.com/watch?v=abc123')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is stable for one link and differs for two links', async () => {
    const a = await hashVideoLink('https://www.youtube.com/watch?v=abc123');
    expect(await hashVideoLink('https://www.youtube.com/watch?v=abc123')).toBe(a);
    expect(await hashVideoLink('https://www.youtube.com/watch?v=zzz999')).not.toBe(a);
  });
  it('does not collide with the hash of a file that holds the same text', async () => {
    const link = 'https://www.youtube.com/watch?v=abc123';
    expect(await hashVideoLink(link)).not.toBe(await hashFile(new File([link], 'x.txt')));
  });
});
