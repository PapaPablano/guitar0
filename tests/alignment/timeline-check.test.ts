import { describe, expect, it } from 'vitest';
import { checkTimeline, outcomeTier } from '../../src/alignment/timeline-check';
import { barSpans } from '../helpers/synthetic-audio';

const bars = barSpans(8, 2);
const steady = (lead = 1.5) => bars.map((b) => b.start + lead);
const end = (anchors: number[]) => anchors[anchors.length - 1] + 2;

describe('checkTimeline', () => {
  it('passes a clean timeline with no problems', () => {
    const anchors = steady();
    expect(checkTimeline(bars, anchors, end(anchors))).toEqual([]);
  });

  it('fails anchors that decrease, and names the bar', () => {
    const anchors = steady();
    anchors[4] = anchors[3] - 0.5;
    const problems = checkTimeline(bars, anchors, end(anchors));
    expect(problems.map((p) => p.kind)).toContain('decreasing');
    expect(problems.find((p) => p.kind === 'decreasing')?.bar).toBe(3);
  });

  it('fails a missing bar', () => {
    const anchors = steady().slice(0, 7);
    expect(checkTimeline(bars, anchors, 20)).toEqual([expect.objectContaining({ kind: 'count' })]);
  });

  it('fails a position that is not a number', () => {
    const anchors = steady();
    anchors[2] = Number.NaN;
    expect(checkTimeline(bars, anchors, end(steady())).map((p) => p.kind)).toEqual(['not-finite']);
  });

  it('fails a bar far longer than the tab\'s with no sign of a part the band added', () => {
    const anchors = steady();
    for (let k = 4; k < anchors.length; k++) anchors[k] += 900;
    expect(checkTimeline(bars, anchors, end(anchors)).map((p) => p.kind)).toEqual(['too-long']);
  });

  it('fails a bar played for a fraction of a second, which is neither played nor skipped', () => {
    const anchors = steady();
    for (let k = 4; k < anchors.length; k++) anchors[k] -= 1.85;
    const problems = checkTimeline(bars, anchors, end(anchors));
    expect(problems.map((p) => p.kind)).toContain('too-short');
  });

  it('passes a skipped bar that shares the next one\'s anchor, and a deliberate long bar', () => {
    const anchors = steady();
    anchors[3] = anchors[4]; // bar 4 is skipped
    expect(checkTimeline(bars, anchors, end(anchors))).toEqual([]);
    const withExtra = steady();
    for (let k = 5; k < withExtra.length; k++) withExtra[k] += 16; // 16 s of extra playing in bar 5
    expect(checkTimeline(bars, withExtra, end(withExtra))).toEqual([]);
  });

  it('fails a start that is further from the tab than the offset range allows', () => {
    const anchors = steady(10_000);
    expect(checkTimeline(bars, anchors, end(anchors)).map((p) => p.kind)).toContain('out-of-range');
  });
});

describe('outcomeTier', () => {
  const anchors = steady();
  it('is lined up when most played bars are supported', () => {
    expect(outcomeTier(bars.map(() => 0.01), bars.map(() => false), anchors, end(anchors))).toBe('lined-up');
    expect(outcomeTier(bars.map(() => 0.2), bars.map(() => true), anchors, end(anchors))).toBe('lined-up');
  });

  it('is roughly lined up when too many bars are neither confirmed nor certain', () => {
    expect(outcomeTier(bars.map(() => 0.2), bars.map((_, k) => k < 3), anchors, end(anchors))).toBe('roughly');
  });

  it('does not count bars the recording skips', () => {
    const skipping = steady();
    skipping[1] = skipping[2];
    skipping[5] = skipping[6];
    const uncertainty = bars.map((_, k) => (k === 1 || k === 5 ? 5 : 0.01));
    expect(outcomeTier(uncertainty, bars.map(() => false), skipping, end(skipping))).toBe('lined-up');
  });
});
