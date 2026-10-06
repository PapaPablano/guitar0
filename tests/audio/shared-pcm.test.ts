import { describe, expect, it, vi } from 'vitest';
import { decodeRecording } from '../../src/alignment/analyze';
import { FEATURE_RATE } from '../../src/alignment/features';
import type { PcmDeps } from '../../src/audio/recording-pcm';
import { openSharedPcm, peekSharedPcm, readSharedPcm } from '../../src/audio/shared-pcm';

const notMp3 = () => new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, ...new Array(100).fill(0)])]);

function counting(seconds: number, rate = 48000) {
  const decode = vi.fn(async () => {
    const samples = new Float32Array(seconds * rate).fill(0.25);
    return { left: samples, right: samples, sampleRate: rate };
  });
  return { deps: { decode } satisfies PcmDeps, decode };
}

describe('the shared store', () => {
  it('is opened once for a file, whoever asks, and found again by anything that asks later', async () => {
    const file = notMp3();
    const { deps, decode } = counting(5);
    expect(await peekSharedPcm(file)).toBeNull();
    const first = openSharedPcm(file, 5, deps);
    const second = openSharedPcm(file, 5, deps);
    expect(second).toBe(first);
    await first;
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await peekSharedPcm(file)).not.toBeNull();
  });

  it('is a separate store for each file', async () => {
    const a = notMp3();
    const b = notMp3();
    const { deps, decode } = counting(2);
    await openSharedPcm(a, 2, deps);
    await openSharedPcm(b, 2, deps);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('gives the whole recording as float samples at its own rate', async () => {
    const file = notMp3();
    const { deps } = counting(5);
    await openSharedPcm(file, 5, deps);
    const audio = (await readSharedPcm(file))!;
    expect(audio.sampleRate).toBe(48000);
    expect(audio.left).toHaveLength(5 * 48000);
    expect(audio.left[1000]).toBeCloseTo(0.25, 3);
  });

  it('gives nothing when nobody opened one, or the recording is too long to keep', async () => {
    expect(await readSharedPcm(notMp3())).toBeNull();
    const long = notMp3();
    await openSharedPcm(long, 1500, counting(1).deps);
    expect(await readSharedPcm(long)).toBeNull();
  });
});

describe('analysis and export share the one decode', () => {
  it('covers AE3: loading, analysing and exporting a recording decodes the file once', async () => {
    const file = notMp3();
    const { deps, decode } = counting(5);
    const own = vi.fn(async () => new Float32Array(10));
    await openSharedPcm(file, 5, deps); // the exact copy opens it as the recording loads
    const mono = await decodeRecording(file, { decode: own });
    const exported = await readSharedPcm(file);
    expect(own).not.toHaveBeenCalled();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(mono.length).toBeGreaterThan(5 * FEATURE_RATE - 50);
    expect(mono.length).toBeLessThan(5 * FEATURE_RATE + 50);
    expect(exported?.left).toHaveLength(5 * 48000);
  });

  it('the analysis keeps its own decode for a recording the store cannot hold', async () => {
    const file = notMp3();
    await openSharedPcm(file, 1500, counting(1).deps);
    const own = vi.fn(async () => new Float32Array(10));
    expect(await decodeRecording(file, { decode: own })).toHaveLength(10);
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('and for one nobody opened a store for', async () => {
    const own = vi.fn(async () => new Float32Array(7));
    expect(await decodeRecording(notMp3(), { decode: own })).toHaveLength(7);
  });

  it('decodes a recording once for the analysis however many times it is run', async () => {
    const file = notMp3();
    const own = vi.fn(async () => new Float32Array(7));
    await decodeRecording(file, { decode: own });
    await decodeRecording(file, { decode: own });
    expect(own).toHaveBeenCalledTimes(1);
  });
});
