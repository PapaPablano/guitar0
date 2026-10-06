import type { AlignmentMap, BarSpan } from '../audio/alignment-map';
import type { PcmAudio } from '../export/audio';
import { MAX_EXPORT_SECONDS } from '../export/presets';
import type { Timeline } from '../model/score';
import type { WorkerMessage, WorkerReply } from './alignment.worker';
import { FEATURE_RATE } from './features';
import { mapOfResult, type MatchJob, type MatchJobResult } from './job';

/** Recordings longer than this are not analysed, so memory stays bounded. */
export const MAX_ANALYSIS_SECONDS = 30 * 60;

export type AnalysisResult =
  | {
      readonly kind: 'aligned';
      readonly map: AlignmentMap;
      readonly confidence: number;
      readonly matchedFraction: number;
      /** Stretches where the recording skips bars the tab has; the tab jumps past them. */
      readonly skippedStretches: number;
      readonly barConfidence: readonly number[];
      readonly barMatched: readonly boolean[];
    }
  | { readonly kind: 'not-found'; readonly reason: 'too-long' | 'silent' | 'not-confident' | 'out-of-range' }
  | { readonly kind: 'failed'; readonly reason: 'decode' | 'render' | 'worker' }
  | { readonly kind: 'cancelled' };

export interface AnalysisJob {
  /** Settles once with one of the results above; never rejects. */
  readonly result: Promise<AnalysisResult>;
  /** Stops the analysis; a late answer from the worker is dropped and the result is `cancelled`. */
  cancel(): void;
}

export interface MatchRun {
  readonly result: Promise<MatchJobResult>;
  terminate(): void;
}

/** The browser pieces the analysis uses, so tests pass fakes. */
export interface AnalysisDeps {
  /** The recording as mono samples at `FEATURE_RATE`. */
  decode(file: Blob): Promise<Float32Array>;
  startMatch(job: MatchJob, onProgress: (fraction: number) => void): MatchRun;
}

export interface AnalysisArgs {
  readonly file: Blob;
  /** The recording's length, known from its audio element before anything is decoded. */
  readonly durationSeconds: number;
  /** The tab's length, to refuse a render the page could not hold. */
  readonly tabSeconds: number;
  readonly bars: readonly BarSpan[];
  /** Renders the whole tab at its original tempo; the app passes the synthesizer's export. */
  readonly renderTab: (onProgress: (fraction: number) => void) => Promise<PcmAudio>;
  /** Called with 0..1, only ever upward. */
  readonly onProgress?: (fraction: number) => void;
}

/** The tab's played bars in tab seconds; each gets an anchor. */
export function barSpansOf(timeline: Timeline): BarSpan[] {
  return timeline.bars.map((bar) => ({ start: bar.startSeconds, end: bar.endSeconds }));
}

const browserDeps: AnalysisDeps = {
  async decode(file) {
    // The context's own rate makes the browser resample while decoding, so no full-rate copy is held.
    const context = new OfflineAudioContext(1, 1, FEATURE_RATE);
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
    }
    return mono;
  },
  startMatch(job, onProgress) {
    const worker = new Worker(new URL('./alignment.worker.ts', import.meta.url), { type: 'module' });
    const result = new Promise<MatchJobResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerReply>) => {
        const reply = e.data;
        if (reply.type === 'progress') onProgress(reply.fraction);
        else if (reply.type === 'done') {
          worker.terminate();
          resolve(reply.result);
        } else {
          worker.terminate();
          reject(new Error(reply.message));
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || 'The alignment worker stopped unexpectedly.'));
      };
      const transfer: Transferable[] = [job.recording.buffer, job.tab.left.buffer];
      if (job.tab.right.buffer !== job.tab.left.buffer) transfer.push(job.tab.right.buffer);
      const message: WorkerMessage = { type: 'run', job };
      worker.postMessage(message, transfer);
    });
    return { result, terminate: () => worker.terminate() };
  },
};

/**
 * Compares a recording with the tab's render in the background. Stages: decode the recording (to 10%), render
 * the tab (to 70%), match in a worker (the rest). Every failure is a result, never a thrown error.
 */
export function startAnalysis(args: AnalysisArgs, deps: AnalysisDeps = browserDeps): AnalysisJob {
  let cancelled = false;
  let run: MatchRun | null = null;
  let settle: (result: AnalysisResult) => void = () => {};
  const result = new Promise<AnalysisResult>((resolve) => {
    settle = resolve;
  });

  let reported = 0;
  const report = (fraction: number) => {
    if (cancelled || fraction <= reported) return;
    reported = Math.min(1, fraction);
    args.onProgress?.(reported);
  };

  void (async () => {
    if (!Number.isFinite(args.durationSeconds) || args.durationSeconds > MAX_ANALYSIS_SECONDS || args.tabSeconds > MAX_EXPORT_SECONDS) {
      return settle({ kind: 'not-found', reason: 'too-long' });
    }
    let recording: Float32Array;
    try {
      recording = await deps.decode(args.file);
    } catch {
      return settle({ kind: 'failed', reason: 'decode' });
    }
    if (cancelled) return;
    report(0.1);
    let tab: PcmAudio;
    try {
      tab = await args.renderTab((fraction) => report(0.1 + 0.6 * fraction));
    } catch {
      return settle({ kind: 'failed', reason: 'render' });
    }
    if (cancelled) return;
    report(0.7);
    try {
      run = deps.startMatch({ recording, tab, bars: args.bars }, (fraction) => report(0.7 + 0.3 * fraction));
      const answer = await run.result;
      if (cancelled) return;
      report(1);
      const map = mapOfResult(answer);
      settle(
        map && answer.kind === 'aligned'
          ? { kind: 'aligned', map, confidence: answer.confidence, matchedFraction: answer.matchedFraction, skippedStretches: answer.skippedStretches, barConfidence: answer.barConfidence, barMatched: answer.barMatched }
          : answer.kind === 'not-found'
            ? { kind: 'not-found', reason: answer.reason }
            : { kind: 'failed', reason: 'worker' },
      );
    } catch {
      if (!cancelled) settle({ kind: 'failed', reason: 'worker' });
    }
  })();

  return {
    result,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      run?.terminate();
      settle({ kind: 'cancelled' });
    },
  };
}
