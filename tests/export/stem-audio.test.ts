import { describe, expect, it, vi } from 'vitest';
import { renderStemMix, type StemSources } from '../../src/export/stem-audio';
import type { PcmAudio } from '../../src/export/audio';
import { initialMix } from '../../src/audio/mix-gains';
import { STEM_NAMES, type StemName } from '../../src/stems/engine-client';

const D = 4 / 48000; // four samples
const LEVEL: Record<StemName, number> = { vocals: 0.01, drums: 0.02, bass: 0.04, guitar: 0.5, piano: 0.08, other: 0.16 };

function sources(): StemSources {
  const s = {} as StemSources;
  for (const name of STEM_NAMES) s[name] = new Blob([name]);
  return s;
}

/** Decodes a stem to a constant signal whose level identifies the stem. */
function fakeDecode(length = 4) {
  return vi.fn(async (blob: Blob, _offset?: number, _duration?: number): Promise<PcmAudio> => {
    const name = (await blob.text()) as StemName;
    const data = new Float32Array(length).fill(LEVEL[name]);
    return { left: data, right: data.slice(), sampleRate: 48000 };
  });
}

describe('renderStemMix', () => {
  it('covers AE5: with the guitar muted the audio is the sum of the other five and has no guitar', async () => {
    const mix = initialMix();
    mix.guitar.muted = true;
    const decode = fakeDecode();
    const pcm = await renderStemMix(sources(), mix, 0, D, decode);
    expect(pcm.left[0]).toBeCloseTo(0.01 + 0.02 + 0.04 + 0.08 + 0.16, 6);
    expect(decode.mock.calls.map(([b]) => b)).toHaveLength(5);
  });

  it('renders only a soloed stem', async () => {
    const mix = initialMix();
    mix.bass.solo = true;
    const pcm = await renderStemMix(sources(), mix, 0, D, fakeDecode());
    expect(pcm.left[0]).toBeCloseTo(0.04, 6);
    expect(pcm.right[3]).toBeCloseTo(0.04, 6);
  });

  it('applies volume', async () => {
    const mix = initialMix();
    for (const n of STEM_NAMES) mix[n].muted = n !== 'guitar';
    mix.guitar.volume = 0.5;
    const pcm = await renderStemMix(sources(), mix, 0, D, fakeDecode());
    expect(pcm.left[0]).toBeCloseTo(0.25, 6);
  });

  it('asks the decoder to skip the same offset for every stem', async () => {
    const decode = fakeDecode();
    await renderStemMix(sources(), initialMix(), 2.5, D, decode);
    for (const call of decode.mock.calls) {
      expect(call[1]).toBe(2.5);
      expect(call[2]).toBe(D);
    }
  });

  it('passes a negative (later start) offset to the decoder unchanged', async () => {
    const decode = fakeDecode();
    await renderStemMix(sources(), initialMix(), -1.5, D, decode);
    expect(decode.mock.calls).toHaveLength(6);
    for (const call of decode.mock.calls) expect(call[1]).toBe(-1.5);
  });

  it('covers AE5 and AE7: with a later start and the guitar muted the delayed sum has no guitar and silence first', async () => {
    const mix = initialMix();
    mix.guitar.muted = true;
    // A fake decode that honours the signed offset the way decodeUserRecording does: one sample of silence.
    const decode = vi.fn(async (blob: Blob, offset = 0): Promise<PcmAudio> => {
      const name = (await blob.text()) as StemName;
      const data = new Float32Array(4).fill(LEVEL[name]);
      if (offset < 0) data.fill(0, 0, 1);
      return { left: data, right: data.slice(), sampleRate: 48000 };
    });
    const pcm = await renderStemMix(sources(), mix, -0.00002, D, decode);
    expect(pcm.left[0]).toBe(0);
    expect(pcm.left[1]).toBeCloseTo(0.01 + 0.02 + 0.04 + 0.08 + 0.16, 6);
    expect(decode.mock.calls).toHaveLength(5);
  });

  it('tolerates a stem that decodes shorter than the others', async () => {
    const decode = vi.fn(async (blob: Blob): Promise<PcmAudio> => {
      const name = (await blob.text()) as StemName;
      const length = name === 'drums' ? 2 : 4;
      const data = new Float32Array(length).fill(0.1);
      return { left: data, right: data.slice(), sampleRate: 48000 };
    });
    const pcm = await renderStemMix(sources(), initialMix(), 0, D, decode);
    expect(pcm.left.length).toBe(4);
    expect(pcm.left[0]).toBeCloseTo(0.6, 6);
    expect(pcm.left[3]).toBeCloseTo(0.5, 6);
  });

  it('fails the export with the stem name instead of rendering a partial mix', async () => {
    const decode = vi.fn(async (blob: Blob): Promise<PcmAudio> => {
      if ((await blob.text()) === 'piano') throw new Error('bad data');
      const data = new Float32Array(4);
      return { left: data, right: data, sampleRate: 48000 };
    });
    await expect(renderStemMix(sources(), initialMix(), 0, D, decode)).rejects.toThrow(/piano/);
  });

  it('does not let a loud sum run past full scale', async () => {
    const decode = vi.fn(async (): Promise<PcmAudio> => {
      const data = new Float32Array(4).fill(0.9);
      return { left: data, right: data.slice(), sampleRate: 48000 };
    });
    const pcm = await renderStemMix(sources(), initialMix(), 0, D, decode);
    expect(pcm.left[0]).toBe(1);
  });
});

import { renderStemMixRange, windowPlacement } from '../../src/export/stem-audio';

describe('windowPlacement', () => {
  it('applies the offset as playback does: recording position = tab time + offset', () => {
    expect(windowPlacement(2, 10, 5)).toEqual({ delaySeconds: 0, startSeconds: 12, audible: true });
    expect(windowPlacement(-3, 10, 5)).toEqual({ delaySeconds: 0, startSeconds: 7, audible: true });
  });

  it('puts silence first when a negative offset reaches past the window start', () => {
    expect(windowPlacement(-1.5, 0, 5)).toEqual({ delaySeconds: 1.5, startSeconds: 0, audible: true });
    expect(windowPlacement(-30, 0, 5)).toEqual({ delaySeconds: 30, startSeconds: 0, audible: false });
  });

  it('clamps the offset to the shared range', () => {
    expect(windowPlacement(-100, 40, 5).startSeconds).toBe(10);
  });
});

describe('renderStemMixRange', () => {
  it('renders only the window and passes start and offset to the decoder', async () => {
    const calls: [number, number, number][] = [];
    const decode = async (blob: Blob, offset: number, start: number, duration: number): Promise<PcmAudio> => {
      calls.push([offset, start, duration]);
      const name = (await blob.text()) as StemName;
      const n = Math.ceil(duration * 48000);
      const d = new Float32Array(n).fill(LEVEL[name]);
      return { left: d, right: d.slice(), sampleRate: 48000 };
    };
    const mix = initialMix();
    mix.guitar.muted = true;
    const pcm = await renderStemMixRange(sources(), mix, 1.5, { startSeconds: 10, durationSeconds: 4 / 48000 }, decode);
    expect(pcm.left.length).toBe(4);
    expect(pcm.left[0]).toBeCloseTo(0.01 + 0.02 + 0.04 + 0.08 + 0.16, 6);
    expect(calls).toHaveLength(5);
    expect(calls.every(([o, s, d]) => o === 1.5 && s === 10 && d === 4 / 48000)).toBe(true);
  });

  it('fails the whole export when a stem cannot be decoded', async () => {
    const decode = async (): Promise<PcmAudio> => {
      throw new Error('bad');
    };
    await expect(renderStemMixRange(sources(), initialMix(), 0, { startSeconds: 0, durationSeconds: D }, decode)).rejects.toThrow(/stem could not be read/);
  });
});
