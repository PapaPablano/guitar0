/** A small deterministic random source, so the test sound is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** One tone burst of the test signal, in seconds from its start. */
export interface TestBurst {
  readonly start: number;
  readonly end: number;
  readonly amplitude: number;
}

/**
 * The built-in sound the recording setup check plays. It varies over time on purpose: a steady tone is exactly what the
 * browser's noise suppression removes, so the signal is a short chirp to line the capture up, tone bursts at stepped
 * levels to expose automatic gain and gating, and a stretch of pink noise to expose lost highs.
 */
export interface TestSignal {
  readonly sampleRate: number;
  readonly samples: Float32Array;
  readonly chirp: { readonly start: number; readonly end: number };
  readonly bursts: readonly TestBurst[];
  readonly noise: { readonly start: number; readonly end: number };
}

const CHIRP_SECONDS = 0.25;
const BURST_START = 0.45;
const BURST_ON = 0.2;
const BURST_OFF = 0.2;
const BURST_HZ = 1000;
/** Stepped so a gain stage pulling every burst to one level shows as a spread. The loudest stays well under full scale. */
const BURST_LEVELS = [0.05, 0.1, 0.2, 0.4, 0.2, 0.1];
const NOISE_SECONDS = 1;
const TAIL_SECONDS = 0.3;

/** Pink-ish noise from white noise with Paul Kellet's filter; deterministic, scaled to the given peak. */
function pinkNoise(length: number, peak: number): Float32Array {
  const random = seeded(2026);
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let max = 0;
  for (let i = 0; i < length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    max = Math.max(max, Math.abs(out[i]));
  }
  for (let i = 0; i < length; i++) out[i] = (out[i] / max) * peak;
  return out;
}

/** Builds the test sound at the given sample rate. The same every time. */
export function buildTestSignal(sampleRate: number): TestSignal {
  const burstsEnd = BURST_START + BURST_LEVELS.length * (BURST_ON + BURST_OFF);
  const noiseStart = burstsEnd + 0.05;
  const total = noiseStart + NOISE_SECONDS + TAIL_SECONDS;
  const samples = new Float32Array(Math.ceil(total * sampleRate));

  // An exponential sweep from 500 Hz to 2.5 kHz: it has one sharp correlation peak, so the capture can be lined up on it.
  const f0 = 500;
  const f1 = 2500;
  const k = Math.log(f1 / f0) / CHIRP_SECONDS;
  for (let i = 0; i < Math.floor(CHIRP_SECONDS * sampleRate); i++) {
    const t = i / sampleRate;
    const fade = Math.min(1, t / 0.005, (CHIRP_SECONDS - t) / 0.005);
    samples[i] = 0.3 * fade * Math.sin((2 * Math.PI * f0 * (Math.exp(k * t) - 1)) / k);
  }

  const bursts: TestBurst[] = BURST_LEVELS.map((amplitude, n) => {
    const start = BURST_START + n * (BURST_ON + BURST_OFF);
    return { start, end: start + BURST_ON, amplitude };
  });
  for (const burst of bursts) {
    const from = Math.floor(burst.start * sampleRate);
    const to = Math.floor(burst.end * sampleRate);
    for (let i = from; i < to; i++) {
      const t = (i - from) / sampleRate;
      const fade = Math.min(1, t / 0.005, (BURST_ON - t) / 0.005);
      samples[i] = burst.amplitude * fade * Math.sin(2 * Math.PI * BURST_HZ * t);
    }
  }

  const noise = pinkNoise(Math.floor(NOISE_SECONDS * sampleRate), 0.2);
  samples.set(noise, Math.floor(noiseStart * sampleRate));

  return {
    sampleRate,
    samples,
    chirp: { start: 0, end: CHIRP_SECONDS },
    bursts,
    noise: { start: noiseStart, end: noiseStart + NOISE_SECONDS },
  };
}

/** The slice of an audio context the check plays through; a fake stands in for it in tests. */
export interface ToneContext {
  readonly sampleRate: number;
  readonly destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): { getChannelData(channel: number): Float32Array };
  createBufferSource(): { buffer: unknown; onended: ((...args: never[]) => unknown) | null; connect(destination: unknown): void; start(when?: number): void };
}

/** Plays the test sound into the page's output and resolves when it has finished. Create the context from a click. */
export function playTestSignal(context: ToneContext, signal: TestSignal): Promise<void> {
  const buffer = context.createBuffer(1, signal.samples.length, signal.sampleRate);
  buffer.getChannelData(0).set(signal.samples);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  return new Promise<void>((resolve) => {
    source.onended = () => resolve();
    source.start();
  });
}
