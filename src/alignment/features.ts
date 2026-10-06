import type { PcmAudio } from '../export/audio';

/**
 * Both signals are brought to this rate before features are taken; it is plenty for pitch content up to 2 kHz.
 * It divides evenly into `CHROMA_RATE` and `ONSET_RATE` frames a second, so a frame index is an exact time.
 */
export const FEATURE_RATE = 11000;
/** Chroma frames per second. */
export const CHROMA_RATE = 10;
/** Onset-envelope values per second. */
export const ONSET_RATE = 100;
export const CHROMA_BINS = 12;

const CHROMA_WINDOW = 4096;
/** A short window keeps the envelope peak close to the moment a note starts. */
const ONSET_WINDOW = 256;
const CHROMA_LOW_HZ = 65;
const CHROMA_HIGH_HZ = 2000;
/** Windows quieter than this (RMS) count as silence and give a zero vector. */
const SILENCE_RMS = 1e-4;

/** Pitch-class frames, one 12-value vector per frame, laid end to end. Frame `i` is centred on `i / CHROMA_RATE` seconds. */
export interface Chroma {
  readonly frames: Float32Array;
  readonly count: number;
}

/** In-place radix-2 FFT; the length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Fills `re` with the windowed samples centred on `centre`, zero past either end; returns the window's RMS before windowing. */
function loadWindow(samples: Float32Array, centre: number, window: Float64Array, re: Float64Array, im: Float64Array): number {
  const n = window.length;
  const from = centre - n / 2;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const at = from + i;
    const x = at >= 0 && at < samples.length ? samples[at] : 0;
    energy += x * x;
    re[i] = x * window[i];
    im[i] = 0;
  }
  return Math.sqrt(energy / n);
}

/** 12-bin pitch-class features (C is bin 0), each frame length-normalised; silent frames are all zero. */
export function chromaFrames(samples: Float32Array, rate: number = FEATURE_RATE): Chroma {
  const hop = Math.round(rate / CHROMA_RATE);
  const count = Math.floor(samples.length / hop);
  const frames = new Float32Array(count * CHROMA_BINS);
  const window = hann(CHROMA_WINDOW);
  const re = new Float64Array(CHROMA_WINDOW);
  const im = new Float64Array(CHROMA_WINDOW);
  const classOf = new Int8Array(CHROMA_WINDOW / 2).fill(-1);
  for (let k = 1; k < classOf.length; k++) {
    const hz = (k * rate) / CHROMA_WINDOW;
    if (hz < CHROMA_LOW_HZ || hz > CHROMA_HIGH_HZ) continue;
    const midi = Math.round(69 + 12 * Math.log2(hz / 440));
    classOf[k] = ((midi % 12) + 12) % 12;
  }
  const bins = new Float64Array(CHROMA_BINS);
  for (let i = 0; i < count; i++) {
    const rms = loadWindow(samples, i * hop, window, re, im);
    if (rms < SILENCE_RMS) continue;
    fft(re, im);
    bins.fill(0);
    for (let k = 1; k < classOf.length; k++) {
      const pc = classOf[k];
      if (pc >= 0) bins[pc] += Math.sqrt(Math.hypot(re[k], im[k]));
    }
    let norm = 0;
    for (let b = 0; b < CHROMA_BINS; b++) norm += bins[b] * bins[b];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    for (let b = 0; b < CHROMA_BINS; b++) frames[i * CHROMA_BINS + b] = bins[b] / norm;
  }
  return { frames, count };
}

/** Spectral flux at `ONSET_RATE` values per second: how much the spectrum grew since the frame before. Flat for silence. */
export function onsetEnvelope(samples: Float32Array, rate: number = FEATURE_RATE): Float32Array {
  const hop = Math.round(rate / ONSET_RATE);
  const count = Math.floor(samples.length / hop);
  const out = new Float32Array(count);
  const window = hann(ONSET_WINDOW);
  const re = new Float64Array(ONSET_WINDOW);
  const im = new Float64Array(ONSET_WINDOW);
  const half = ONSET_WINDOW / 2;
  let previous = new Float64Array(half);
  let current = new Float64Array(half);
  for (let i = 0; i < count; i++) {
    loadWindow(samples, i * hop, window, re, im);
    fft(re, im);
    let flux = 0;
    for (let k = 0; k < half; k++) {
      current[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
      const rise = current[k] - previous[k];
      if (rise > 0) flux += rise;
    }
    out[i] = flux;
    [previous, current] = [current, previous];
  }
  return out;
}

/**
 * Averages the channels to mono and brings them to `targetRate` with a windowed-sinc low-pass, so content
 * above the new Nyquist rate does not fold down into the pitch range.
 */
export function downsampleMono(pcm: PcmAudio, targetRate: number = FEATURE_RATE): Float32Array {
  const length = Math.min(pcm.left.length, pcm.right.length);
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) mono[i] = (pcm.left[i] + pcm.right[i]) / 2;
  if (pcm.sampleRate === targetRate) return mono;

  const ratio = pcm.sampleRate / targetRate;
  const cutoff = 0.4 / ratio; // cycles per source sample, a little under the new Nyquist rate
  const radius = Math.ceil(16 * ratio);
  const outLength = Math.floor(length / ratio);
  const out = new Float32Array(outLength);
  // With whole-number rates the position of an output sample between source samples repeats every
  // target / gcd outputs, so each distinct kernel is worked out once and reused.
  const common = gcd(pcm.sampleRate, targetRate);
  const phases = targetRate / common;
  const kernels = new Map<number, Float64Array>();
  const kernelFor = (phase: number, fraction: number): Float64Array => {
    let kernel = kernels.get(phase);
    if (kernel) return kernel;
    kernel = new Float64Array(2 * radius);
    let norm = 0;
    for (let t = 0; t < kernel.length; t++) {
      const x = t - radius + 1 - fraction;
      const u = x / radius;
      const y = 2 * cutoff * x;
      const sinc = y === 0 ? 1 : Math.sin(Math.PI * y) / (Math.PI * y);
      const blackman = 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
      kernel[t] = sinc * blackman;
      norm += kernel[t];
    }
    for (let t = 0; t < kernel.length; t++) kernel[t] /= norm;
    kernels.set(phase, kernel);
    return kernel;
  };
  for (let j = 0; j < outLength; j++) {
    const position = j * pcm.sampleRate; // in units of 1 / targetRate source samples
    const base = Math.floor(position / targetRate);
    const phase = ((position % targetRate) / common) % phases;
    const kernel = kernelFor(phase, (position % targetRate) / targetRate);
    const first = base - radius + 1;
    let sum = 0;
    for (let t = 0; t < kernel.length; t++) {
      const at = first + t;
      if (at >= 0 && at < length) sum += mono[at] * kernel[t];
    }
    out[j] = sum;
  }
  return out;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
