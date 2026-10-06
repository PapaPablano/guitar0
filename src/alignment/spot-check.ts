import type { AlignmentRecord, BarEvidence } from '../audio/recording-profile';
import { EVIDENCE, onsetPeaks } from './evidence';
import { FEATURE_RATE, ONSET_RATE, onsetEnvelope } from './features';

/**
 * Least standard score of a bar's onset peak for the bar to count as placed to the beat by its own onsets; the matcher's
 * own cutoff. Only bars placed that way have an onset to look for at their anchor.
 */
export const PINNED_PEAK = 3;

/** How a saved timeline is checked against the recording it belongs to; the reason for each value is beside it. */
export const SPOT_CHECK = {
  /** How many of the bars placed by their onsets are looked at. A few spread over the song is enough to notice an anchor moved off its place. */
  samples: 6,
  /** How far either side of an anchor an onset may sit and still count; the matcher places a bar to a tenth of a second. */
  reachSeconds: 0.15,
  /** Audio kept either side of the anchor so the local level of the onset envelope has surroundings to be read against. */
  padSeconds: 1.5,
  /** The onset gate relative to the matcher's: lenient, since a bar's onset can be quiet beside its surroundings and a miss here re-detects. */
  gateShare: 0.5,
} as const;

export type SpotCheckOptions = { readonly [K in keyof typeof SPOT_CHECK]: number };

export interface SpotCheckResult {
  /** How many anchors were looked at, which is none when no bar of the record was placed by its onsets. */
  readonly checked: number;
  /** The bars (counting from zero) whose anchor has no onset beside it in the recording. */
  readonly failed: readonly number[];
  /** True when nothing could be checked, or every anchor looked at has an onset beside it. */
  readonly ok: boolean;
}

/** The bars a saved record says were placed by their own onsets, at most `count`, spread evenly over the song. */
function sampleBars(anchors: readonly number[], evidence: readonly BarEvidence[], count: number): number[] {
  const eligible: number[] = [];
  for (let k = 0; k < anchors.length; k++) if ((evidence[k]?.confidence ?? 0) >= PINNED_PEAK) eligible.push(k);
  if (eligible.length <= count) return eligible;
  const picked: number[] = [];
  for (let i = 0; i < count; i++) picked.push(eligible[Math.round((i * (eligible.length - 1)) / (count - 1))]);
  return picked;
}

/** Whether the recording has an onset within reach of `at`, read from a short stretch of it so the check costs almost nothing. */
function hasOnsetNear(recording: Float32Array, at: number, o: SpotCheckOptions): boolean {
  const duration = recording.length / FEATURE_RATE;
  if (!Number.isFinite(at) || at < 0 || at > duration) return false;
  const from = Math.max(0, at - o.padSeconds);
  const to = Math.min(duration, at + o.padSeconds);
  const slice = recording.subarray(Math.floor(from * FEATURE_RATE), Math.ceil(to * FEATURE_RATE));
  const peaks = onsetPeaks(onsetEnvelope(slice), { ...EVIDENCE, onsetGate: EVIDENCE.onsetGate * o.gateShare });
  const centre = Math.round((at - from) * ONSET_RATE);
  const reach = Math.round(o.reachSeconds * ONSET_RATE);
  for (let t = Math.max(0, centre - reach); t <= Math.min(peaks.length - 1, centre + reach); t++) if (peaks[t] > 0) return true;
  return false;
}

/**
 * Looks at a few of a saved record's anchors, the ones the matcher placed by their own onsets, and asks whether the
 * recording still has an onset beside each. A freshly detected anchor does; one moved by hand onto silence, a timeline
 * saved for another take, or a file that no longer matches its recording does not.
 */
export function spotCheck(recording: Float32Array, anchors: readonly number[], evidence: readonly BarEvidence[], o: SpotCheckOptions = SPOT_CHECK): SpotCheckResult {
  const bars = sampleBars(anchors, evidence, o.samples);
  const failed = bars.filter((k) => !hasOnsetNear(recording, anchors[k], o));
  return { checked: bars.length, failed, ok: failed.length === 0 };
}

/**
 * The check for a saved record and its recording, or null when it cannot be made: the record has no anchors, no per-bar
 * evidence, or the recording cannot be decoded. Never rejects.
 */
export async function checkRecord(file: Blob, record: AlignmentRecord, decode: (file: Blob) => Promise<Float32Array>): Promise<SpotCheckResult | null> {
  if (!record.anchors || !record.evidence) return null;
  try {
    return spotCheck(await decode(file), record.anchors, record.evidence);
  } catch {
    return null;
  }
}
