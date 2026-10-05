import { describe, expect, it } from 'vitest';
import {
  CHROMA_BINS,
  CHROMA_RATE,
  FEATURE_RATE,
  ONSET_RATE,
  chromaFrames,
  downsampleMono,
  onsetEnvelope,
} from '../../src/alignment/features';
import { concat, midiToHz, silence, tone } from '../helpers/synthetic-audio';

const R = FEATURE_RATE;

function frame(chroma: { frames: Float32Array }, i: number): Float32Array {
  return chroma.frames.subarray(i * CHROMA_BINS, (i + 1) * CHROMA_BINS);
}

function argmax(v: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function chord(midis: number[], rich: boolean, seconds = 2): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * R));
  for (const midi of midis) {
    const hz = midiToHz(midi);
    const harmonics = rich ? [1, 0.6, 0.4, 0.3] : [1];
    for (let h = 0; h < harmonics.length; h++) {
      for (let i = 0; i < out.length; i++) out[i] += 0.1 * harmonics[h] * Math.sin((2 * Math.PI * hz * (h + 1) * i) / R);
    }
  }
  return out;
}

describe('chromaFrames', () => {
  it('puts a 440 Hz tone in the A pitch class, and the same note an octave away in the same class', () => {
    for (const hz of [220, 440, 880]) {
      const chroma = chromaFrames(tone(hz, 2, R), R);
      expect(argmax(frame(chroma, 10))).toBe(9);
    }
  });

  it('gives the same chord in two timbres similar frames, and different chords clearly different ones', () => {
    const cMajorPlain = frame(chromaFrames(chord([48, 52, 55], false), R), 10);
    const cMajorRich = frame(chromaFrames(chord([60, 64, 67], true), R), 10);
    const fMajor = frame(chromaFrames(chord([53, 57, 60], false), R), 10);
    expect(cosine(cMajorPlain, cMajorRich)).toBeGreaterThan(0.9);
    expect(cosine(cMajorPlain, fMajor)).toBeLessThan(0.75);
  });

  it('gives zero vectors for silence, with no NaN', () => {
    const chroma = chromaFrames(silence(2, R), R);
    expect(chroma.count).toBeGreaterThan(0);
    for (const v of chroma.frames) expect(v).toBe(0);
  });

  it('gives no frames for no samples', () => {
    expect(chromaFrames(new Float32Array(0), R).count).toBe(0);
  });

  it('gives about ten chroma frames and a hundred onset values per second', () => {
    const samples = tone(440, 10, R);
    expect(Math.abs(chromaFrames(samples, R).count - 10 * CHROMA_RATE)).toBeLessThanOrEqual(1);
    expect(Math.abs(onsetEnvelope(samples, R).length - 10 * ONSET_RATE)).toBeLessThanOrEqual(2);
  });
});

describe('onsetEnvelope', () => {
  it('peaks within 20 ms of each note start', () => {
    const note = (hz: number) => tone(hz, 0.4, R);
    const samples = concat(silence(0.5, R), note(330), silence(0.3, R), note(440), silence(0.5, R));
    const starts = [0.5, 1.2];
    const env = onsetEnvelope(samples, R);
    for (const start of starts) {
      const lo = Math.round((start - 0.15) * ONSET_RATE);
      const hi = Math.round((start + 0.15) * ONSET_RATE);
      let peak = lo;
      for (let i = lo; i <= hi; i++) if (env[i] > env[peak]) peak = i;
      expect(Math.abs(peak / ONSET_RATE - start)).toBeLessThanOrEqual(0.02);
    }
  });

  it('is flat for silence', () => {
    for (const v of onsetEnvelope(silence(1, R), R)) expect(v).toBe(0);
  });
});

describe('downsampleMono', () => {
  it('averages the channels and keeps the length ratio', () => {
    const left = tone(440, 2, 48000);
    const right = new Float32Array(left.length);
    const out = downsampleMono({ left, right, sampleRate: 48000 }, R);
    expect(out.length).toBeCloseTo(2 * R, -1);
    // half of the left channel's amplitude
    let peak = 0;
    for (let i = 1000; i < out.length - 1000; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeCloseTo(0.25, 1);
  });

  it('does not let a tone above the new Nyquist rate fold down into the pitch range', () => {
    // 10 kHz would fold to about 1 kHz at 11025 Hz if it were not filtered out first
    const left = tone(10000, 1, 48000);
    const out = downsampleMono({ left, right: left, sampleRate: 48000 }, R);
    let peak = 0;
    for (let i = 1000; i < out.length - 1000; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeLessThan(0.005);
  });

  it('returns the samples as they are when the rate already matches', () => {
    const left = tone(440, 1, R);
    const out = downsampleMono({ left, right: left, sampleRate: R }, R);
    expect(out.length).toBe(left.length);
    expect(out[100]).toBeCloseTo(left[100], 6);
  });
});
