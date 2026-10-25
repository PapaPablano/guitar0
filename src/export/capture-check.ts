import type { TestSignal } from '../audio/capture-test-tone';

/** What the browser did to the test sound. */
export type EffectKind = 'level-change' | 'automatic-gain' | 'gating' | 'lost-highs' | 'nothing-captured';

export interface Effect {
  readonly kind: EffectKind;
  /** The number behind the effect, in dB: the level change, the spread between bursts, the lowest burst, or the fall in the highs. */
  readonly measured: number;
}

export interface CheckReport {
  readonly verdict: 'clean' | 'altered' | 'nothing';
  readonly effects: readonly Effect[];
  /** How late the captured sound arrived, in seconds. */
  readonly latencySeconds: number;
  /** Whether the capture could be lined up on the leading chirp. */
  readonly aligned: boolean;
}

/** A level change this small cannot be heard; anything past it is reported. */
const LEVEL_CHANGE_DB = 3;
/** Bursts played at different levels that come back this far apart in gain were levelled by an automatic gain stage. */
const GAIN_SPREAD_DB = 3;
/** A burst this far below the typical one was removed. */
const GATED_DB = 20;
/** The top end this far below the middle counts as lost. */
const LOST_HIGHS_DB = 6;
/** Below this the capture holds no sound at all. */
const SILENT_RMS = 1e-4;
/** Correlation on the chirp below this means the capture cannot be lined up. */
const MIN_CORRELATION = 0.2;
const DECIMATE = 8;
const FFT_SIZE = 4096;

const db = (ratio: number): number => (ratio <= 1e-12 ? -120 : 20 * Math.log10(ratio));

function rms(samples: Float32Array, from: number, to: number): number {
  const end = Math.min(samples.length, to);
  let sum = 0;
  for (let i = Math.max(0, from); i < end; i++) sum += samples[i] * samples[i];
  const count = end - Math.max(0, from);
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

/** Linear resampling; good enough to compare band levels, not meant for listening. */
function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const out = new Float32Array(Math.max(1, Math.floor((samples.length * to) / from)));
  for (let i = 0; i < out.length; i++) {
    const at = (i * from) / to;
    const lo = Math.floor(at);
    const frac = at - lo;
    out[i] = samples[lo] * (1 - frac) + (samples[Math.min(samples.length - 1, lo + 1)] ?? 0) * frac;
  }
  return out;
}

function decimated(samples: Float32Array, from: number, to: number): Float32Array {
  const count = Math.max(0, Math.floor((to - from) / DECIMATE));
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < DECIMATE; j++) sum += samples[from + i * DECIMATE + j] ?? 0;
    out[i] = sum / DECIMATE;
  }
  return out;
}

/** The lag, in samples, at which the capture best matches the played chirp. */
function findLag(played: TestSignal, captured: Float32Array): { lag: number; correlation: number } {
  const rate = played.sampleRate;
  const from = Math.floor(played.chirp.start * rate);
  const to = Math.floor(played.chirp.end * rate);
  const reference = decimated(played.samples, from, to);
  const maxLagDecimated = Math.floor((1.5 * rate) / DECIMATE);
  const target = decimated(captured, 0, Math.min(captured.length, to + maxLagDecimated * DECIMATE));
  let referenceEnergy = 0;
  for (const s of reference) referenceEnergy += s * s;
  if (referenceEnergy === 0) return { lag: 0, correlation: 0 };
  // Running window energy of the capture, so each lag can be normalised.
  const prefix = new Float64Array(target.length + 1);
  for (let i = 0; i < target.length; i++) prefix[i + 1] = prefix[i] + target[i] * target[i];
  let best = { lag: 0, correlation: 0 };
  for (let lag = 0; lag + reference.length <= target.length && lag <= maxLagDecimated; lag++) {
    let dot = 0;
    for (let i = 0; i < reference.length; i++) dot += reference[i] * target[lag + i];
    const windowEnergy = prefix[lag + reference.length] - prefix[lag];
    if (windowEnergy <= 0) continue;
    const correlation = dot / Math.sqrt(windowEnergy * referenceEnergy);
    if (correlation > best.correlation) best = { lag, correlation };
  }
  // Refine at the full rate around the coarse lag.
  const full = from;
  const length = to - from;
  let refined = best.lag * DECIMATE;
  let bestDot = -Infinity;
  for (let candidate = Math.max(0, best.lag * DECIMATE - DECIMATE * 2); candidate <= best.lag * DECIMATE + DECIMATE * 2; candidate++) {
    let dot = 0;
    for (let i = 0; i < length; i++) dot += played.samples[full + i] * (captured[candidate + i] ?? 0);
    if (dot > bestDot) {
      bestDot = dot;
      refined = candidate;
    }
  }
  return { lag: refined, correlation: best.correlation };
}

/** In-place radix-2 FFT. */
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
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

/** Average power in each band, over Hann-windowed frames of the stretch. */
function bandPowers(samples: Float32Array, from: number, to: number, rate: number, bands: ReadonlyArray<readonly [number, number]>): number[] {
  const totals = bands.map(() => 0);
  const hann = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  const hop = FFT_SIZE / 2;
  for (let start = from; start + FFT_SIZE <= to; start += hop) {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) re[i] = (samples[start + i] ?? 0) * hann[i];
    fft(re, im);
    bands.forEach(([low, high], b) => {
      const first = Math.max(1, Math.floor((low * FFT_SIZE) / rate));
      const last = Math.min(FFT_SIZE / 2 - 1, Math.ceil((high * FFT_SIZE) / rate));
      for (let bin = first; bin <= last; bin++) totals[b] += re[bin] * re[bin] + im[bin] * im[bin];
    });
  }
  return totals;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Compares what was captured with the test sound that was played, and says what the browser did to it. Pure: it takes
 * samples and returns numbers, so it is tested with synthetic signals.
 */
export function analyseCapture(played: TestSignal, capturedSamples: Float32Array, capturedRate: number): CheckReport {
  const rate = played.sampleRate;
  const captured = resample(capturedSamples, capturedRate, rate);
  const whole = rms(captured, 0, captured.length);
  if (whole < SILENT_RMS) {
    return { verdict: 'nothing', effects: [{ kind: 'nothing-captured', measured: db(whole) }], latencySeconds: 0, aligned: false };
  }

  const found = findLag(played, captured);
  const aligned = found.correlation >= MIN_CORRELATION;
  const lag = aligned ? found.lag : 0;
  const shifted = captured.subarray(lag);
  const effects: Effect[] = [];

  // Level of each burst against what was played, using the middle of the burst to stay clear of its edges.
  const gains = played.bursts.map((burst) => {
    const margin = (burst.end - burst.start) * 0.2;
    const from = Math.floor((burst.start + margin) * rate);
    const to = Math.floor((burst.end - margin) * rate);
    return db(rms(shifted, from, to) / (rms(played.samples, from, to) || 1));
  });
  const typical = median(gains);
  const kept = gains.filter((g) => g > typical - GATED_DB);
  if (Math.abs(typical) > LEVEL_CHANGE_DB) effects.push({ kind: 'level-change', measured: typical });
  if (kept.length > 1 && Math.max(...kept) - Math.min(...kept) > GAIN_SPREAD_DB) {
    effects.push({ kind: 'automatic-gain', measured: Math.max(...kept) - Math.min(...kept) });
  }
  if (kept.length < gains.length && typical > -GATED_DB) effects.push({ kind: 'gating', measured: Math.min(...gains) });

  // The top end against the middle, over the noise: a band that falls away alone was filtered, a drop everywhere is just level.
  const bands: Array<readonly [number, number]> = [
    [800, 1250],
    [6400, 10000],
    [12800, 19200],
  ];
  const from = Math.floor((played.noise.start + 0.05) * rate);
  const to = Math.floor((played.noise.end - 0.05) * rate);
  const playedPower = bandPowers(played.samples, from, to, rate, bands);
  const capturedPower = bandPowers(shifted, from, to, rate, bands);
  const ratio = (band: number): number => 10 * Math.log10((capturedPower[band] || 1e-12) / (playedPower[band] || 1e-12));
  const highsFall = Math.min(ratio(1) - ratio(0), ratio(2) - ratio(0));
  if (highsFall < -LOST_HIGHS_DB) effects.push({ kind: 'lost-highs', measured: highsFall });

  return { verdict: effects.length ? 'altered' : 'clean', effects, latencySeconds: lag / rate, aligned };
}

const dbText = (value: number): string => `${Math.abs(Math.round(value * 10) / 10)} dB`;

/** The report in plain words, one line per effect. */
export function describeEffects(report: CheckReport): string[] {
  if (report.verdict === 'clean') return ['The test sound came through unchanged.'];
  return report.effects.map((effect) => {
    switch (effect.kind) {
      case 'nothing-captured':
        return 'No sound was captured. Share the tab and tick "Share tab audio".';
      case 'level-change':
        return `The captured sound was ${dbText(effect.measured)} ${effect.measured < 0 ? 'quieter' : 'louder'} than the test sound.`;
      case 'automatic-gain':
        return `Automatic gain was levelling the sound: quiet and loud parts came back ${dbText(effect.measured)} closer together.`;
      case 'gating':
        return 'Parts of the test sound were removed, the way noise suppression removes steady tones.';
      case 'lost-highs':
        return `Highs were cut by ${dbText(effect.measured)} against the middle of the sound, which makes it muffled.`;
    }
  });
}
