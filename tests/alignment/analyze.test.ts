import { describe, expect, it, vi } from 'vitest';
import { barFactsOf, barSpansOf, MAX_ANALYSIS_SECONDS, MAX_ANALYSIS_TAB_SECONDS, startAnalysis, type AnalysisDeps, type MatchRun } from '../../src/alignment/analyze';
import { FEATURE_RATE } from '../../src/alignment/features';
import { runMatchJob, type MatchJob, type MatchJobResult } from '../../src/alignment/job';
import { initialMix } from '../../src/audio/mix-gains';
import { stemAnalysisFeed, type StemSources } from '../../src/export/stem-audio';
import { STEM_NAMES } from '../../src/stems/engine-client';
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
      sections: [],
      perBarData: { base: 1.5, holds: [] },
      tier: 'lined-up',
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

  it('carries the anchors, per-bar confidence and sections of the answer through', async () => {
    const { deps, answer } = fakes();
    const job = startAnalysis(args(), deps);
    await flush();
    answer({
      kind: 'aligned',
      data: { base: 1, holds: [] },
      confidence: 6,
      matchedFraction: 1,
      skippedStretches: 1,
      barConfidence: [5, 0, 4],
      barMatched: [true, false, true],
      sections: [{ firstBar: 0, lastBar: 2, letter: 'A' }],
      perBarData: { base: 1, holds: [] },
      tier: 'roughly',
    });
    const result = await job.result;
    expect(result.kind).toBe('aligned');
    if (result.kind === 'aligned') {
      expect(result.barConfidence).toEqual([5, 0, 4]);
      expect(result.barMatched).toEqual([true, false, true]);
      expect(result.skippedStretches).toBe(1);
      expect(result.sections).toEqual([{ firstBar: 0, lastBar: 2, letter: 'A' }]);
    }
  });

  it('hands the per-bar facts to the match job as given', async () => {
    const { deps } = fakes();
    const barFacts = [{ tempo: 120, beats: 4, scoreBar: 0 }, { tempo: 90, beats: 3, scoreBar: 1 }, { tempo: 90, beats: 3, scoreBar: 1 }];
    const job = startAnalysis(args({ barFacts }), deps);
    await flush();
    job.cancel();
    expect(vi.mocked(deps.startMatch).mock.calls[0][0].barFacts).toEqual(barFacts);
    const without = startAnalysis(args(), fakes().deps);
    without.cancel();
  });

  it('decodes a file once for the session, so re-analysing it starts from what is already there', async () => {
    const { deps } = fakes();
    const file = new Blob(['same bytes']);
    const first = startAnalysis(args({ file }), deps);
    await flush();
    first.cancel();
    const second = startAnalysis(args({ file }), deps);
    await flush();
    second.cancel();
    expect(deps.decode).toHaveBeenCalledTimes(1);
    const other = startAnalysis(args({ file: new Blob(['other bytes']) }), deps);
    await flush();
    other.cancel();
    expect(deps.decode).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed decode, so the next try decodes again', async () => {
    let calls = 0;
    const { deps } = fakes({
      decode: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('bad file');
        return new Float32Array(FEATURE_RATE);
      }),
    });
    const file = new Blob(['bytes']);
    expect(await startAnalysis(args({ file }), deps).result).toEqual({ kind: 'failed', reason: 'decode' });
    const again = startAnalysis(args({ file }), deps);
    await flush();
    again.cancel();
    expect(calls).toBe(2);
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
    const tabLong = startAnalysis(args({ tabSeconds: MAX_ANALYSIS_TAB_SECONDS + 1 }), deps);
    expect(await tabLong.result).toEqual({ kind: 'not-found', reason: 'too-long' });
    expect(deps.decode).not.toHaveBeenCalled();
  });

  it('lines up a tab as long as fifteen minutes', () => {
    expect(MAX_ANALYSIS_TAB_SECONDS).toBe(15 * 60);
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
    answer({ kind: 'aligned', data: { base: 1, holds: [] }, confidence: 6, matchedFraction: 1, skippedStretches: 0, barConfidence: [], barMatched: [], sections: [], perBarData: { base: 1, holds: [] }, tier: 'lined-up' });
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

  it('uses a supplied feed instead of decoding a file, and hands those samples to the match job', async () => {
    const { deps } = fakes();
    const feed = new Float32Array([0.1, 0.2, 0.3]);
    const samples = vi.fn(async () => feed);
    const job = startAnalysis({ ...args(), file: undefined, samples }, deps);
    await flush();
    job.cancel();
    expect(samples).toHaveBeenCalledTimes(1);
    expect(deps.decode).not.toHaveBeenCalled();
    expect(vi.mocked(deps.startMatch).mock.calls[0][0].recording).toBe(feed);
  });

  it('fails cleanly when the supplied feed cannot be built, and starts no worker', async () => {
    const { deps } = fakes();
    const job = startAnalysis({ ...args(), file: undefined, samples: vi.fn(async () => Promise.reject(new Error('stem unreadable'))) }, deps);
    expect(await job.result).toEqual({ kind: 'failed', reason: 'decode' });
    expect(deps.startMatch).not.toHaveBeenCalled();
  });

  it('fails cleanly when neither a file nor a feed is given', async () => {
    const { deps } = fakes();
    const job = startAnalysis({ ...args(), file: undefined }, deps);
    expect(await job.result).toEqual({ kind: 'failed', reason: 'decode' });
  });

  it('refuses a take over thirty minutes without building the feed', async () => {
    const { deps } = fakes();
    const samples = vi.fn(async () => new Float32Array(10));
    const job = startAnalysis({ ...args({ durationSeconds: MAX_ANALYSIS_SECONDS + 1 }), file: undefined, samples }, deps);
    expect(await job.result).toEqual({ kind: 'not-found', reason: 'too-long' });
    expect(samples).not.toHaveBeenCalled();
  });

  it('cancelling while the feed is being built returns cancelled and never starts the worker', async () => {
    const { deps } = fakes();
    let finish: (f: Float32Array) => void = () => {};
    const job = startAnalysis({ ...args(), file: undefined, samples: () => new Promise<Float32Array>((resolve) => (finish = resolve)) }, deps);
    await flush();
    job.cancel();
    finish(new Float32Array(10));
    expect(await job.result).toEqual({ kind: 'cancelled' });
    await flush();
    expect(deps.startMatch).not.toHaveBeenCalled();
  });

  describe('a take split into stems, judged against the tab (covers AE1)', () => {
    const notes = songNotes(24, 2, 51);
    const tab48 = renderSong(notes, 48, 48000, 'plain');
    // Two stems that each carry half of the song's notes, like a take whose parts were split; the whole take starts 12 s late.
    const stemSamples: Record<string, Float32Array> = {
      guitar: shifted(renderSong(notes.filter((_, i) => i % 2 === 0), 48, FEATURE_RATE, 'rich', 61), 12, FEATURE_RATE),
      other: shifted(renderSong(notes.filter((_, i) => i % 2 === 1), 48, FEATURE_RATE, 'rich', 62), 12, FEATURE_RATE),
    };
    const sources = {} as StemSources;
    for (const name of STEM_NAMES) sources[name] = new Blob([name]);
    const decodeStem = async (blob: Blob) => stemSamples[await blob.text()] ?? new Float32Array(0);
    const real: AnalysisDeps = {
      decode: async () => new Float32Array(0),
      startMatch: (job: MatchJob, onProgress) => ({ result: Promise.resolve(runMatchJob(job, onProgress)), terminate: () => {} }),
    };
    const judge = (mix: ReturnType<typeof initialMix>) =>
      startAnalysis(
        {
          samples: () => stemAnalysisFeed(sources, mix, decodeStem),
          durationSeconds: 60,
          tabSeconds: 48,
          bars: barSpans(24, 2),
          renderTab: async () => pcm(tab48, 48000),
        },
        real,
      ).result;

    it('finds the 12 s start from the mix of all the stems', { timeout: 30000 }, async () => {
      const result = await judge(initialMix());
      expect(result.kind).toBe('aligned');
      if (result.kind === 'aligned') {
        expect(Math.abs(result.map.base - 12)).toBeLessThanOrEqual(0.05);
        expect(result.map.holds).toHaveLength(0);
      }
    });

    it('also finds it from the mix without the guitar stem', { timeout: 30000 }, async () => {
      const mix = initialMix();
      mix.guitar.muted = true;
      const result = await judge(mix);
      expect(result.kind).toBe('aligned');
      if (result.kind === 'aligned') expect(Math.abs(result.map.base - 12)).toBeLessThanOrEqual(0.05);
    });
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
      expect(result.map.hasAnchors).toBe(true);
      expect(result.barConfidence).toHaveLength(24);
      expect(result.sections.length).toBeGreaterThanOrEqual(1);
      expect(result.sections[0].firstBar).toBe(0);
      expect(result.sections[result.sections.length - 1].lastBar).toBe(23);
    }
  });
});

describe('barSpansOf', () => {
  it('lists the start and end of every played bar', () => {
    const timeline = makeTimeline([], 2, 3);
    expect(barSpansOf(timeline)).toEqual(timeline.bars.map((b) => ({ start: b.startSeconds, end: b.endSeconds })));
  });
});

describe('barFactsOf', () => {
  it('gives each played bar its tempo, beats and score bar, across a tempo step, a meter change and a repeat', () => {
    const timeline = makeTimeline([], 2, 4);
    const bars = timeline.bars.map((bar, k) => ({
      ...bar,
      tempo: k < 2 ? 120 : 90,
      timeSignature: { numerator: k === 3 ? 3 : 4, denominator: 4 },
      scoreBar: k === 3 ? 2 : k, // the tab plays score bar 2 twice
    }));
    expect(barFactsOf({ ...timeline, bars })).toEqual([
      { tempo: 120, beats: 4, scoreBar: 0 },
      { tempo: 120, beats: 4, scoreBar: 1 },
      { tempo: 90, beats: 4, scoreBar: 2 },
      { tempo: 90, beats: 3, scoreBar: 2 },
    ]);
  });
});
