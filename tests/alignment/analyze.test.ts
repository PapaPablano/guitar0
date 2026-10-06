import { describe, expect, it, vi } from 'vitest';
import { barSpansOf, MAX_ANALYSIS_SECONDS, startAnalysis, type AnalysisDeps, type MatchRun } from '../../src/alignment/analyze';
import { FEATURE_RATE } from '../../src/alignment/features';
import { runMatchJob, type MatchJob, type MatchJobResult } from '../../src/alignment/job';
import { MAX_EXPORT_SECONDS } from '../../src/export/presets';
import { makeTimeline } from '../helpers/make-timeline';
import { barSpans, inserted, renderSong, shifted, songNotes, unrelatedMusic } from '../helpers/synthetic-audio';

const pcm = (samples: Float32Array, sampleRate: number) => ({ left: samples, right: samples, sampleRate });

function fakes(over: Partial<AnalysisDeps> = {}) {
  const terminate = vi.fn();
  let finish: (r: MatchJobResult) => void = () => {};
  const deps: AnalysisDeps = {
    decode: vi.fn(async () => new Float32Array(FEATURE_RATE)),
    startMatch: vi.fn((): MatchRun => ({ result: new Promise<MatchJobResult>((resolve) => (finish = resolve)), terminate })),
    ...over,
  };
  return { deps, terminate, answer: (r: MatchJobResult) => finish(r) };
}

const args = (over = {}) => ({
  file: new Blob(['x']),
  durationSeconds: 60,
  tabSeconds: 60,
  bars: barSpans(3, 2),
  renderTab: vi.fn(async (onProgress: (f: number) => void) => {
    onProgress(0.5);
    onProgress(1);
    return pcm(new Float32Array(48000), 48000);
  }),
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startAnalysis', () => {
  it('returns the aligned map with progress that only goes up to one', async () => {
    const { deps, answer } = fakes();
    const seen: number[] = [];
    const job = startAnalysis(args({ onProgress: (f: number) => seen.push(f) }), deps);
    await flush();
    answer({
      kind: 'aligned',
      data: { base: 1.5, holds: [{ at: 20, length: 16 }] },
      confidence: 6,
      matchedFraction: 1,
      skippedStretches: 0,
      barConfidence: [],
      barMatched: [],
    });
    const result = await job.result;
    expect(result.kind).toBe('aligned');
    if (result.kind === 'aligned') {
      expect(result.map.base).toBe(1.5);
      expect(result.map.holds).toEqual([{ at: 20, length: 16 }]);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('passes a not-found answer through', async () => {
    const { deps, answer } = fakes();
    const job = startAnalysis(args(), deps);
    await flush();
    answer({ kind: 'not-found', reason: 'not-confident' });
    expect(await job.result).toEqual({ kind: 'not-found', reason: 'not-confident' });
  });

  it('skips a recording over thirty minutes, and a tab too long to render, without decoding anything', async () => {
    const { deps } = fakes();
    const long = startAnalysis(args({ durationSeconds: MAX_ANALYSIS_SECONDS + 1 }), deps);
    expect(await long.result).toEqual({ kind: 'not-found', reason: 'too-long' });
    const tabLong = startAnalysis(args({ tabSeconds: MAX_EXPORT_SECONDS + 1 }), deps);
    expect(await tabLong.result).toEqual({ kind: 'not-found', reason: 'too-long' });
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it('does not decode a recording whose length is not a finite number', async () => {
    const { deps } = fakes();
    for (const durationSeconds of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const job = startAnalysis(args({ durationSeconds }), deps);
      expect(await job.result).toEqual({ kind: 'not-found', reason: 'too-long' });
    }
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it('fails cleanly when decoding fails, and starts no worker', async () => {
    const { deps } = fakes({ decode: vi.fn(async () => Promise.reject(new Error('bad file'))) });
    const job = startAnalysis(args(), deps);
    expect(await job.result).toEqual({ kind: 'failed', reason: 'decode' });
    expect(deps.startMatch).not.toHaveBeenCalled();
  });

  it('fails cleanly when the tab cannot be rendered, and starts no worker', async () => {
    const { deps } = fakes();
    const job = startAnalysis(args({ renderTab: vi.fn(async () => Promise.reject(new Error('no sound'))) }), deps);
    expect(await job.result).toEqual({ kind: 'failed', reason: 'render' });
    expect(deps.startMatch).not.toHaveBeenCalled();
  });

  it('fails cleanly when the worker fails', async () => {
    const { deps } = fakes({ startMatch: vi.fn((): MatchRun => ({ result: Promise.reject(new Error('boom')), terminate: vi.fn() })) });
    const job = startAnalysis(args(), deps);
    expect(await job.result).toEqual({ kind: 'failed', reason: 'worker' });
  });

  it('cancelling mid-run returns no answer, stops the worker, and drops a late reply', async () => {
    const { deps, answer, terminate } = fakes();
    const seen: number[] = [];
    const job = startAnalysis(args({ onProgress: (f: number) => seen.push(f) }), deps);
    await flush();
    job.cancel();
    expect(await job.result).toEqual({ kind: 'cancelled' });
    expect(terminate).toHaveBeenCalled();
    const reported = seen.length;
    answer({ kind: 'aligned', data: { base: 1, holds: [] }, confidence: 6, matchedFraction: 1, skippedStretches: 0, barConfidence: [], barMatched: [] });
    await flush();
    expect(seen.length).toBe(reported);
  });

  it('cancelling before the render finishes never starts the worker', async () => {
    const { deps } = fakes();
    let finishRender: (p: ReturnType<typeof pcm>) => void = () => {};
    const job = startAnalysis(args({ renderTab: () => new Promise((resolve) => (finishRender = resolve)) }), deps);
    await flush();
    job.cancel();
    finishRender(pcm(new Float32Array(10), 48000));
    expect(await job.result).toEqual({ kind: 'cancelled' });
    await flush();
    expect(deps.startMatch).not.toHaveBeenCalled();
  });

  it('runs the real matcher through the job shapes: a late start and an extra section are found in a render at 48 kHz', { timeout: 30000 }, async () => {
    const notes = songNotes(24, 2, 51);
    const tab48 = renderSong(notes, 48, 48000, 'plain');
    const recording = shifted(inserted(renderSong(notes, 48, FEATURE_RATE, 'rich', 61), 20, unrelatedMusic(12, FEATURE_RATE, 71), FEATURE_RATE), 1, FEATURE_RATE);
    const real: AnalysisDeps = {
      decode: async () => recording,
      startMatch: (job: MatchJob, onProgress) => ({ result: Promise.resolve(runMatchJob(job, onProgress)), terminate: () => {} }),
    };
    const job = startAnalysis(
      {
        file: new Blob(['x']),
        durationSeconds: 61,
        tabSeconds: 48,
        bars: barSpans(24, 2),
        renderTab: async () => pcm(tab48, 48000),
      },
      real,
    );
    const result = await job.result;
    expect(result.kind).toBe('aligned');
    if (result.kind === 'aligned') {
      expect(Math.abs(result.map.base - 1)).toBeLessThanOrEqual(0.03);
      expect(result.map.holds).toHaveLength(1);
      expect(result.map.holds[0].at).toBe(20);
      expect(Math.abs(result.map.holds[0].length - 12)).toBeLessThanOrEqual(0.05);
    }
  });
});

describe('barSpansOf', () => {
  it('lists the start and end of every played bar', () => {
    const timeline = makeTimeline([], 2, 3);
    expect(barSpansOf(timeline)).toEqual(timeline.bars.map((b) => ({ start: b.startSeconds, end: b.endSeconds })));
  });
});
