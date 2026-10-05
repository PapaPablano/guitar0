import type { Hold } from '../audio/alignment-map';
import { AlignmentMap } from '../audio/alignment-map';
import type { PcmAudio } from '../export/audio';
import { chromaFrames, downsampleMono, FEATURE_RATE, onsetEnvelope } from './features';
import { matchRecording } from './match';

/** What the worker is given: the recording as mono samples at `FEATURE_RATE`, the tab's render at its own rate, and the bar lines. */
export interface MatchJob {
  readonly recording: Float32Array;
  readonly tab: PcmAudio;
  readonly barLines: readonly number[];
}

/** The matcher's answer as plain data, so it can cross the worker boundary. */
export type MatchJobResult =
  | {
      readonly kind: 'aligned';
      readonly base: number;
      readonly holds: readonly Hold[];
      readonly confidence: number;
      readonly matchedFraction: number;
      readonly unfollowed: number;
    }
  | { readonly kind: 'not-found'; readonly reason: 'silent' | 'not-confident' | 'out-of-range' };

/** Everything the worker does, as one function, so the worker file stays a thin shell and tests can run it directly. */
export function runMatchJob(job: MatchJob, onProgress: (fraction: number) => void = () => {}): MatchJobResult {
  const tab = downsampleMono(job.tab, FEATURE_RATE);
  onProgress(0.2);
  const recording = job.recording;
  const features = {
    recording: chromaFrames(recording, FEATURE_RATE),
    tab: chromaFrames(tab, FEATURE_RATE),
    recordingOnsets: onsetEnvelope(recording, FEATURE_RATE),
    tabOnsets: onsetEnvelope(tab, FEATURE_RATE),
    barLines: job.barLines,
  };
  onProgress(0.5);
  const result = matchRecording(features);
  onProgress(1);
  if (result.kind === 'not-found') return result;
  const data = result.map.toData();
  return { kind: 'aligned', base: data.base, holds: data.holds, confidence: result.confidence, matchedFraction: result.matchedFraction, unfollowed: result.unfollowed };
}

/** The result as a map; null when it was not aligned. */
export function mapOfResult(result: MatchJobResult): AlignmentMap | null {
  return result.kind === 'aligned' ? AlignmentMap.of(result.base, result.holds) : null;
}
