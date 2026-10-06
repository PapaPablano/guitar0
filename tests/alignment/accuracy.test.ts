import { describe, expect, it } from 'vitest';
import { chromaFrames, FEATURE_RATE, onsetEnvelope } from '../../src/alignment/features';
import { matchRecording } from '../../src/alignment/match';
import { renderSong } from '../helpers/synthetic-audio';
import {
  accuracyOf,
  busyTab,
  driftingLengths,
  performanceOf,
  spansOf,
  steadyLengths,
  sustainedTab,
  type TabFixture,
} from '../helpers/timeline-accuracy';

const R = FEATURE_RATE;
const LEAD = 1.5;

interface Run {
  readonly found: number[];
  readonly truth: number[];
  readonly skipped: boolean[];
}

/** Renders the tab and a band's performance of it, detects, and reads every bar's recording time off the result. */
function detect(tab: TabFixture, recordedLengths: readonly number[]): Run {
  const performance = performanceOf(tab, recordedLengths, LEAD);
  const tabSamples = renderSong(tab.notes, tab.seconds, R, 'plain');
  const recording = renderSong(performance.notes, performance.seconds, R, 'rich', 17);
  const result = matchRecording({
    recording: chromaFrames(recording, R),
    tab: chromaFrames(tabSamples, R),
    recordingOnsets: onsetEnvelope(recording, R),
    tabOnsets: onsetEnvelope(tabSamples, R),
    bars: spansOf(tab.bars),
  });
  if (result.kind !== 'aligned') throw new Error(`not aligned: ${result.reason}`);
  return {
    found: tab.bars.map((b) => result.map.toRec(b.start, 'start')),
    truth: performance.anchors,
    skipped: recordedLengths.map((length) => length <= 0),
  };
}

const steady = (count: number, length = 2): number[] => Array.from({ length: count }, () => length);

/** The fixtures every tolerance test draws on, named for what they stress. */
const fixtures = {
  busy: () => busyTab(steady(30)),
  sustained: () => sustainedTab(steady(32), 4),
  sustainedLong: () => sustainedTab(steady(32), 8, 31),
  tempoSteps: () => sustainedTab([...steady(10, 2), ...steady(10, 1.6), ...steady(10, 2.4)], 5),
  mixedMeters: () => busyTab([...steady(8, 2), ...steady(4, 1.5), ...steady(8, 2), ...steady(4, 2.5)]),
};

/**
 * Baseline of the detector before the whole-song pass (commit 583c00a), on `fixtures` played at the tab's own bar lengths:
 * every fixture but `sustainedLong` is exact, `sustainedLong` has 78% of bars within 40 ms (worst 90 ms), and a band whose
 * bar length drifts 3% over sustained chords has 38% within 40 ms (median 71 ms, worst 261 ms), while the same drift with a chord on every bar already passes. The tests below that the baseline misses are
 * `it.fails`, so they pass today and turn red the moment the whole-song pass meets them; U9 flips them to `it`.
 */
const TIGHT = 0.03;
const DRIFT = 0.04;

const sharesAt = (run: Run, limit: number): number => {
  const r = accuracyOf(run.found, run.truth, run.skipped);
  return r.errors.filter((e) => e <= limit + 1e-9).length / r.errors.length;
};

describe('timeline accuracy on generated recordings', { timeout: 60000 }, () => {
  it('reports a per-bar error list and the share within each tolerance', () => {
    const tab = fixtures.busy();
    const run = detect(tab, steadyLengths(tab.bars));
    const report = accuracyOf(run.found, run.truth, run.skipped);
    expect(report.errors).toHaveLength(tab.bars.length);
    expect(report.within100).toBeGreaterThan(0.9);
    expect(report.within20).toBeLessThanOrEqual(report.within40);
    expect(report.within40).toBeLessThanOrEqual(report.within100);
  });

  it('measures the same fixture identically twice', () => {
    const tab = fixtures.sustained();
    const a = detect(tab, steadyLengths(tab.bars));
    const b = detect(tab, steadyLengths(tab.bars));
    expect(b.found).toEqual(a.found);
  });

  it('lands every bar of tight recordings with a chord on each bar, a tempo step or a change of meter within 30 ms', () => {
    for (const name of ['busy', 'sustained', 'tempoSteps', 'mixedMeters'] as const) {
      const tab = fixtures[name]();
      expect(sharesAt(detect(tab, steadyLengths(tab.bars)), TIGHT), name).toBe(1);
    }
  });

  // The baseline's gap: bars inside a long sustained chord have no onset to pin them.
  it.fails('lands bars between strong bars within 40 ms when chords are held for eight bars', () => {
    const tab = fixtures.sustainedLong();
    expect(sharesAt(detect(tab, steadyLengths(tab.bars)), DRIFT)).toBe(1);
  });

  // The baseline's bias: a band whose bar length drifts exposes any fit that treats the whole bar as one length.
  it.fails("lands bars within 40 ms when the band's bar length drifts by up to 3%", () => {
    const tab = sustainedTab(steady(32), 4);
    expect(sharesAt(detect(tab, driftingLengths(tab.bars)), DRIFT)).toBe(1);
  });

  it('lands bars within 40 ms when the band drifts and every bar has a chord', () => {
    const tab = busyTab(steady(32));
    expect(sharesAt(detect(tab, driftingLengths(tab.bars)), DRIFT)).toBe(1);
  });

  it("follows the tab's tempo map in the truth anchors of a tab with tempo steps", () => {
    const tab = fixtures.tempoSteps();
    const performance = performanceOf(tab, steadyLengths(tab.bars), LEAD);
    tab.bars.forEach((bar, k) => expect(performance.anchors[k]).toBeCloseTo(LEAD + bar.start, 9));
    expect(performance.endAnchor).toBeCloseTo(LEAD + tab.seconds, 9);
  });

  it("keeps the bars after a skipped bar on their own positions, and gives the skipped bar the next one's", () => {
    const tab = busyTab(steady(30));
    const lengths = steadyLengths(tab.bars);
    lengths[14] = 0;
    const run = detect(tab, lengths);
    expect(run.found[14]).toBeCloseTo(run.found[15], 1);
    for (const k of [10, 11, 12, 13, 15, 16, 17, 20, 25]) expect(Math.abs(run.found[k] - run.truth[k]), `bar ${k}`).toBeLessThanOrEqual(TIGHT);
  });

  it('shows a bar played twice as long as a whole-bar step, not a small error', () => {
    const tab = busyTab(steady(30));
    const lengths = steadyLengths(tab.bars);
    lengths[14] = 4; // two seconds of extra playing
    const run = detect(tab, lengths);
    expect(run.found[15] - run.found[14]).toBeGreaterThan(3.9);
    expect(run.found[15] - run.found[14]).toBeLessThan(4.1);
    for (const k of [10, 13, 15, 16, 20, 25]) expect(Math.abs(run.found[k] - run.truth[k]), `bar ${k}`).toBeLessThanOrEqual(TIGHT);
  });

  it('shows less within 40 ms for sustained chords than for a chord on every bar, which is the baseline gap', () => {
    const sustained = fixtures.sustainedLong();
    const busy = busyTab(steady(32));
    const a = sharesAt(detect(sustained, steadyLengths(sustained.bars)), DRIFT);
    const b = sharesAt(detect(busy, steadyLengths(busy.bars)), DRIFT);
    expect(a).toBeLessThan(b);
  });

  it('gives identical anchors when the matcher runs twice on one drifting fixture', () => {
    const tab = sustainedTab(steady(32), 4);
    const lengths = driftingLengths(tab.bars);
    expect(detect(tab, lengths).found).toEqual(detect(tab, lengths).found);
  });
});
