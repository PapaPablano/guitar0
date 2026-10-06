import { AlignmentMap, type AlignmentData, type BarSpan } from '../audio/alignment-map';
import type { PcmAudio } from '../export/audio';
import { chromaFrames, downsampleMono, FEATURE_RATE, onsetEnvelope } from './features';
import { matchRecording } from './match';
import { findSections, type Section } from './sections';

/** What the worker is given: the recording as mono samples at `FEATURE_RATE`, the tab's render at its own rate, and the tab's played bars. */
export interface MatchJob {
  readonly recording: Float32Array;
  readonly tab: PcmAudio;
  readonly bars: readonly BarSpan[];
}

/** The matcher's answer as plain data, so it can cross the worker boundary. */
export type MatchJobResult =
  | {
      readonly kind: 'aligned';
      /** The alignment as plain data: one anchor per bar, with the bars they belong to. */
      readonly data: AlignmentData;
      readonly confidence: number;
      readonly matchedFraction: number;
      readonly skippedStretches: number;
      readonly barConfidence: readonly number[];
      readonly barMatched: readonly boolean[];
      /** The recording's parts, as runs of played bars. */
      readonly sections: readonly Section[];
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
    bars: job.bars,
  };
  onProgress(0.5);
  const result = matchRecording(features);
  onProgress(1);
  if (result.kind === 'not-found') return result;
  const data = result.map.toData();
  const sections = data.anchors && data.bars && data.endAnchor !== undefined ? findSections(features.recording, data.bars, data.anchors, data.endAnchor) : [];
  return {
    kind: 'aligned',
    data,
    confidence: result.confidence,
    matchedFraction: result.matchedFraction,
    skippedStretches: result.skippedStretches,
    barConfidence: result.barConfidence,
    barMatched: result.barMatched,
    sections,
  };
}

/** The result as a map; null when it was not aligned. */
export function mapOfResult(result: MatchJobResult): AlignmentMap | null {
  return result.kind === 'aligned' ? AlignmentMap.normalize(result.data) : null;
}
