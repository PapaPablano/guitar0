import type { BarSpan } from '../audio/alignment-map';
import { ONSET_RATE } from './features';

/**
 * Tuning for the evidence curves; the reason for each value is beside it.
 */
export const EVIDENCE = {
  /** How far either side of the path's value for a bar the curve looks. The path moves in tenths of a second and the onset stage may add 0.15 s, so this covers both. */
  reachSeconds: 0.3,
  /**
   * Weight of the bar's last onsets relative to its first. A bar the band plays a little long or short has its start on
   * the line and its late notes off it, so the start decides; the rest still counts, because a bar often has no onset at its line.
   */
  taperEnd: 0.3,
  /** Highest standard score a curve can reach, so one loud bar does not outweigh a whole steady stretch. */
  zCap: 6,
  /** Half-width of the stretch whose median is taken as the level of an onset envelope, so only a rise above its surroundings counts as an onset. */
  baselineSeconds: 0.5,
  /** A rise counts as an onset only above this many times the typical (median) rise in the envelope, so the flutter of a held chord is not read as notes. */
  onsetGate: 6,
} as const;

export type EvidenceOptions = { readonly [K in keyof typeof EVIDENCE]: number };

/**
 * An onset envelope with its local level taken off: each value minus the median of the stretch around it, never below
 * zero. A held chord still has a little spectral flux, and standardising that would read as evidence; a rise well above the
 * surroundings is an onset. Apply it to both the tab's and the recording's envelopes.
 */
export function onsetPeaks(envelope: Float32Array, o: EvidenceOptions = EVIDENCE): Float32Array {
  const half = Math.round(o.baselineSeconds * ONSET_RATE);
  const out = new Float32Array(envelope.length);
  const window: number[] = [];
  for (let t = 0; t < envelope.length; t++) {
    window.length = 0;
    for (let u = Math.max(0, t - half); u <= Math.min(envelope.length - 1, t + half); u++) window.push(envelope[u]);
    window.sort((x, y) => x - y);
    out[t] = Math.max(0, envelope[t] - window[window.length >> 1]);
  }
  const rises = Array.from(out).filter((v) => v > 0).sort((x, y) => x - y);
  const gate = rises.length === 0 ? 0 : o.onsetGate * rises[rises.length >> 1];
  for (let t = 0; t < out.length; t++) if (out[t] < gate) out[t] = 0;
  return out;
}

/** How well each candidate offset (recording seconds minus tab seconds) lines the bar's onsets up. */
export interface EvidenceCurve {
  /** Candidate offsets in seconds, evenly spaced at the onset rate. */
  readonly offsets: Float64Array;
  /** Standard score of the comparison at each offset, capped; all zero when the bar has no onsets to compare. */
  readonly z: Float64Array;
}

/**
 * The comparison of a bar's onsets in the tab with the recording's, at every candidate offset around `centre`, over the
 * bar (not only its first notes) up to `usableEnd` (the start of a wait run in the bar, so extra playing is not read as
 * the bar). The tab's onsets are weighted toward the bar's start; each score is a product sum of the two onset envelopes
 * at the onset rate, then the whole curve is standardised so bars with loud and quiet onsets are comparable.
 */
export function evidenceCurve(
  tabOnsets: Float32Array,
  recordingOnsets: Float32Array,
  bar: BarSpan,
  centre: number,
  usableEnd: number,
  o: EvidenceOptions = EVIDENCE,
): EvidenceCurve | null {
  const reach = Math.round(o.reachSeconds * ONSET_RATE);
  const count = 2 * reach + 1;
  const offsets = new Float64Array(count);
  const z = new Float64Array(count);
  const centreFrames = Math.round(centre * ONSET_RATE);
  for (let j = 0; j < count; j++) offsets[j] = (centreFrames + j - reach) / ONSET_RATE;

  const a = Math.max(0, Math.round(bar.start * ONSET_RATE));
  const b = Math.min(tabOnsets.length, Math.round(Math.min(bar.end, usableEnd) * ONSET_RATE));
  if (b - a < 2) return { offsets, z };
  const span = Math.max(1, b - a - 1);
  const weights = new Float64Array(b - a);
  let energy = 0;
  for (let t = a; t < b; t++) {
    weights[t - a] = tabOnsets[t] * (1 - (1 - o.taperEnd) * ((t - a) / span));
    energy += weights[t - a];
  }
  if (energy <= 1e-9) return { offsets, z };

  const scores = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    const shift = centreFrames + j - reach;
    let score = 0;
    for (let t = a; t < b; t++) {
      const r = t + shift;
      if (r >= 0 && r < recordingOnsets.length) score += weights[t - a] * recordingOnsets[r];
    }
    scores[j] = score;
  }
  let mean = 0;
  for (let j = 0; j < count; j++) mean += scores[j];
  mean /= count;
  let variance = 0;
  for (let j = 0; j < count; j++) variance += (scores[j] - mean) * (scores[j] - mean);
  const std = Math.sqrt(variance / count);
  if (std <= 1e-12) return { offsets, z };
  for (let j = 0; j < count; j++) z[j] = Math.min(o.zCap, (scores[j] - mean) / std);
  return { offsets, z };
}

/** The highest point of a curve, with its offset interpolated between steps (a parabola through the peak and its two neighbours). */
export function peakOf(curve: EvidenceCurve): { offset: number; z: number } {
  let best = 0;
  for (let j = 1; j < curve.z.length; j++) if (curve.z[j] > curve.z[best]) best = j;
  let offset = curve.offsets[best];
  if (best > 0 && best < curve.z.length - 1) {
    const left = curve.z[best - 1];
    const right = curve.z[best + 1];
    const bend = left - 2 * curve.z[best] + right;
    if (bend < -1e-12) offset += (0.5 * (left - right)) / bend / ONSET_RATE;
  }
  return { offset, z: curve.z[best] };
}
