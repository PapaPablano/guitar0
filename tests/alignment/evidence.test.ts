import { describe, expect, it } from 'vitest';
import { EVIDENCE, evidenceCurve, onsetPeaks, peakOf } from '../../src/alignment/evidence';
import { FEATURE_RATE, ONSET_RATE, onsetEnvelope } from '../../src/alignment/features';
import { renderSong } from '../helpers/synthetic-audio';
import { busyTab, performanceOf, steadyLengths, sustainedTab } from '../helpers/timeline-accuracy';

const R = FEATURE_RATE;
const LEAD = 1.5;
const STEP = 1 / ONSET_RATE;

function onsetsOf(tab: ReturnType<typeof busyTab>, lengths: readonly number[], lead = LEAD) {
  const performance = performanceOf(tab, lengths, lead);
  const tabSamples = renderSong(tab.notes, tab.seconds, R, 'plain');
  const recording = renderSong(performance.notes, performance.seconds, R, 'rich', 17);
  return { tabOnsets: onsetPeaks(onsetEnvelope(tabSamples, R)), recordingOnsets: onsetPeaks(onsetEnvelope(recording, R)), performance };
}

describe('evidenceCurve', () => {
  it('peaks at the true offset, to within one step, for a bar with a clear chord', () => {
    const tab = busyTab(Array(12).fill(2));
    const { tabOnsets, recordingOnsets } = onsetsOf(tab, steadyLengths(tab.bars));
    // The path's value is 70 ms off; the curve still finds the truth inside its reach.
    const curve = evidenceCurve(tabOnsets, recordingOnsets, tab.bars[5], LEAD + 0.07, tab.bars[5].end)!;
    const peak = peakOf(curve);
    expect(Math.abs(peak.offset - LEAD)).toBeLessThanOrEqual(STEP + 1e-9);
    expect(peak.z).toBeGreaterThan(3);
  });

  it('is flat but correctly centred for a bar inside a sustained chord', () => {
    const tab = sustainedTab(Array(12).fill(2), 4);
    const { tabOnsets, recordingOnsets } = onsetsOf(tab, steadyLengths(tab.bars));
    const inside = evidenceCurve(tabOnsets, recordingOnsets, tab.bars[6], LEAD + 0.05, tab.bars[6].end)!;
    expect(Math.max(...inside.z)).toBeLessThan(2);
    expect(inside.offsets[(inside.offsets.length - 1) / 2]).toBeCloseTo(LEAD + 0.05, 9);
    const first = evidenceCurve(tabOnsets, recordingOnsets, tab.bars[4], LEAD + 0.05, tab.bars[4].end)!;
    expect(Math.max(...first.z)).toBeGreaterThan(3);
  });

  it('scores a bar holding a wait only up to the wait, so the extra material does not move the peak', () => {
    const tab = busyTab(Array(12).fill(2));
    const lengths = steadyLengths(tab.bars);
    lengths[5] = 5; // three seconds of other playing after bar 5's notes
    const { tabOnsets, recordingOnsets } = onsetsOf(tab, lengths);
    const truth = LEAD;
    const curve = evidenceCurve(tabOnsets, recordingOnsets, tab.bars[5], truth + 0.06, tab.bars[5].end - 0.5)!;
    expect(Math.abs(peakOf(curve).offset - truth)).toBeLessThanOrEqual(STEP + 1e-9);
  });

  it('peaks near the bar start, not at a compromise across the bar, when the bar runs long', () => {
    const tab = busyTab(Array(12).fill(2));
    const lengths = steadyLengths(tab.bars);
    lengths[4] = 2.2; // the band plays bar 4 ten percent slow: its late notes sit 0.2 s late, its start is on time
    const { tabOnsets, recordingOnsets, performance } = onsetsOf(tab, lengths);
    const startOffset = performance.anchors[4] - tab.bars[4].start;
    const curve = evidenceCurve(tabOnsets, recordingOnsets, tab.bars[4], startOffset + 0.05, tab.bars[4].end)!;
    const weighted = peakOf(curve);
    const flat = peakOf(evidenceCurve(tabOnsets, recordingOnsets, tab.bars[4], startOffset + 0.05, tab.bars[4].end, { ...EVIDENCE, taperEnd: 1 })!);
    expect(Math.abs(weighted.offset - startOffset)).toBeLessThanOrEqual(Math.abs(flat.offset - startOffset) + 0.002);
    expect(Math.abs(weighted.offset - startOffset)).toBeLessThanOrEqual(0.03);
  });

  it('gives a flat curve when the tab has no onsets in the bar', () => {
    const silent = new Float32Array(2000);
    const curve = evidenceCurve(silent, silent, { start: 2, end: 4 }, 1, 4)!;
    expect(Math.max(...curve.z)).toBe(0);
    expect(Math.min(...curve.z)).toBe(0);
  });

  it('has one value per candidate offset, spaced at the onset rate', () => {
    const silent = new Float32Array(2000);
    const curve = evidenceCurve(silent, silent, { start: 2, end: 4 }, 1, 4)!;
    expect(curve.z.length).toBe(2 * Math.round(EVIDENCE.reachSeconds * ONSET_RATE) + 1);
    expect(curve.offsets[1] - curve.offsets[0]).toBeCloseTo(STEP, 9);
  });
});
