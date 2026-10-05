import { describe, expect, it, vi } from 'vitest';
import { startExactCopy } from '../../src/app/exact-copy-load';
import { ExactCopyBuilder, type ExactCopyDeps, type ExactCopyResult } from '../../src/audio/exact-copy';
import type { AudioLike } from '../../src/audio/user-audio';

function audio(duration = 120): AudioLike {
  return {
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    paused: true,
    ended: false,
    duration,
    async play() {},
    pause() {},
  };
}

function clockFor(duration = 120) {
  return { element: audio(duration), offerElement: vi.fn() };
}

function copyBuilder(result: ExactCopyResult) {
  return { build: vi.fn(async () => result) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const file = (name = 'song.mp3') => new File(['a'], name, { type: 'audio/mpeg' });

describe('startExactCopy', () => {
  it('offers a ready copy to the clock exactly once', async () => {
    const clock = clockFor();
    const release = vi.fn();
    const element = audio();
    startExactCopy(file(), clock, copyBuilder({ kind: 'copy', url: 'blob:x', release }), async () => element);
    await flush();
    expect(clock.offerElement).toHaveBeenCalledTimes(1);
    expect(clock.offerElement).toHaveBeenCalledWith(element);
  });

  it('passes the recording duration so a long file is skipped before anything is decoded', async () => {
    const clock = clockFor(900);
    const builder = copyBuilder({ kind: 'skipped', reason: 'too-long' });
    startExactCopy(file(), clock, builder, async () => audio());
    await flush();
    expect(builder.build).toHaveBeenCalledWith(expect.any(File), 900);
    expect(clock.offerElement).not.toHaveBeenCalled();
  });

  it('leaves the clock alone and raises nothing when the copy fails or is skipped', async () => {
    for (const result of [{ kind: 'failed' }, { kind: 'skipped', reason: 'already-wav' }] as const) {
      const clock = clockFor();
      startExactCopy(file(), clock, copyBuilder(result), async () => audio());
      await flush();
      expect(clock.offerElement).not.toHaveBeenCalled();
    }
  });

  it('releases the copy and offers nothing when the element cannot be made', async () => {
    const clock = clockFor();
    const release = vi.fn();
    startExactCopy(file(), clock, copyBuilder({ kind: 'copy', url: 'blob:x', release }), async () => {
      throw new Error('cannot load');
    });
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
    expect(clock.offerElement).not.toHaveBeenCalled();
  });

  it('releases a copy that finishes after the recording was replaced and never offers it', async () => {
    const clock = clockFor();
    const release = vi.fn();
    let finish: (r: ExactCopyResult) => void = () => {};
    const builder = { build: vi.fn(() => new Promise<ExactCopyResult>((resolve) => (finish = resolve))) };
    const cancel = startExactCopy(file(), clock, builder, async () => audio());
    cancel();
    finish({ kind: 'copy', url: 'blob:late', release });
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
    expect(clock.offerElement).not.toHaveBeenCalled();
  });

  it('cancelling after the copy was offered gives up the claim on it', async () => {
    const clock = clockFor();
    const release = vi.fn();
    const cancel = startExactCopy(file(), clock, copyBuilder({ kind: 'copy', url: 'blob:x', release }), async () => audio());
    await flush();
    cancel();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('covers R12: loading the same file again reuses the kept copy without a second build', async () => {
    let urls = 0;
    const deps: ExactCopyDeps = {
      decode: vi.fn(async () => ({ left: new Float32Array(2), right: new Float32Array(2), sampleRate: 48000 })),
      encode: vi.fn(() => new Uint8Array(4)),
      hash: vi.fn(async () => 'same'),
      createUrl: vi.fn(() => `blob:${++urls}`),
      revokeUrl: vi.fn(),
    };
    const builder = new ExactCopyBuilder(deps);
    const first = clockFor();
    const cancelFirst = startExactCopy(file(), first, builder, async () => audio());
    await flush();
    cancelFirst();
    const second = clockFor();
    startExactCopy(file(), second, builder, async () => audio());
    await flush();
    expect(deps.decode).toHaveBeenCalledTimes(1);
    expect(first.offerElement).toHaveBeenCalledTimes(1);
    expect(second.offerElement).toHaveBeenCalledTimes(1);
  });
});
