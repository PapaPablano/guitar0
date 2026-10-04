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
