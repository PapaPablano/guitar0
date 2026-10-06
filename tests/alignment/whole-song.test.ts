import { describe, expect, it } from 'vitest';
import { solveChain, type ChainBar } from '../../src/alignment/whole-song';

const N = 61;
const STEP = 0.01;

/** A bar whose candidates run from `centre - 0.3` to `centre + 0.3`, with a sharp peak at `truth` when `strong`, and nothing otherwise. */
function bar(truth: number, o: { strong?: boolean; centre?: number; gap?: number; looseness?: number; free?: boolean } = {}): ChainBar {
  const centre = o.centre ?? 0;
  const offsets = new Float64Array(N);
  const z = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    offsets[j] = Math.round((centre + (j - 30) * STEP) * 1000) / 1000;
    if (o.strong) z[j] = 6 * Math.exp(-((offsets[j] - truth) ** 2) / (2 * 0.01 ** 2));
  }
  return { offsets, z, gap: o.gap ?? 2, looseness: o.looseness ?? 1, free: o.free ?? false };
}

const run = (truths: number[], strongEvery: number, over: (k: number) => Partial<Parameters<typeof bar>[1]> = () => ({})) =>
  solveChain(truths.map((t, k) => bar(t, { strong: k % strongEvery === 0, ...over(k) })));

describe('solveChain', () => {
  it('gives bars with no evidence the offset of the strong bars around them on a steady stretch', () => {
    const solved = run(Array(24).fill(0.05), 4);
    for (const s of solved) expect(Math.abs(s.offset - 0.05)).toBeLessThanOrEqual(0.005);
  });

  it('is not penalised for a band that runs steadily slow: the offset grows by the same amount every bar', () => {
    const truths = Array.from({ length: 24 }, (_, k) => 0.01 * k - 0.1);
    const solved = run(truths, 4);
    truths.forEach((t, k) => expect(Math.abs(solved[k].offset - t), `bar ${k}`).toBeLessThanOrEqual(0.008));
  });

  it('follows a pace that curves slowly, between strong bars, to within 20 ms', () => {
    const truths = Array.from({ length: 32 }, (_, k) => 0.03 * 6 * (1 - Math.cos(k / 6)) - 0.1);
    const solved = run(truths, 4);
    truths.forEach((t, k) => expect(Math.abs(solved[k].offset - t), `bar ${k}`).toBeLessThanOrEqual(0.02));
  });

  it('keeps a real step between two steady stretches, at the bar where the evidence puts it', () => {
    const truths = [...Array(12).fill(0), ...Array(12).fill(0.12)];
    const solved = run(truths, 3);
    expect(Math.abs(solved[5].offset)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(solved[18].offset - 0.12)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(solved[12].offset - 0.12)).toBeLessThanOrEqual(0.01);
  });

  it('lets the pace change more easily at the bar where the tab changes tempo, and nowhere else', () => {
    const truths = [...Array(10).fill(0), ...Array(10).fill(0.1)];
    const loose = solveChain(truths.map((t, k) => bar(t, { strong: k % 3 === 0, looseness: k === 10 ? 4 : 1 })));
    const tight = solveChain(truths.map((t, k) => bar(t, { strong: k % 3 === 0 })));
    // Bar 10 has no evidence of its own; with the step expected there it is placed after the step at least as readily.
    expect(Math.abs(loose[10].offset - 0.1)).toBeLessThanOrEqual(Math.abs(tight[10].offset - 0.1) + 1e-9);
    expect(Math.abs(loose[4].offset)).toBeLessThanOrEqual(0.005);
  });

  it('reads a step across a run of extra playing as free, so the stretches either side settle independently', () => {
    // Offsets are given with the run already taken out: a 0.12 s error of the path's run length shows as a step at the run.
    const truths = [...Array(10).fill(0), ...Array(10).fill(0.12)];
    const solved = solveChain(truths.map((t, k) => bar(t, { strong: k % 4 === 0, free: k === 10 })));
    expect(Math.abs(solved[9].offset)).toBeLessThanOrEqual(0.008);
    expect(Math.abs(solved[10].offset - 0.12)).toBeLessThanOrEqual(0.008);
    expect(Math.abs(solved[11].offset - 0.12)).toBeLessThanOrEqual(0.008);
  });

  it('reports a wider spread for bars far from any evidence than for bars on it', () => {
    const solved = run(Array(17).fill(0), 16);
    expect(solved[8].spread).toBeGreaterThan(solved[0].spread);
    expect(solved[0].spread).toBeLessThan(0.02);
  });

  it('gives the same answer every time', () => {
    const truths = Array.from({ length: 16 }, (_, k) => 0.005 * k);
    expect(run(truths, 5)).toEqual(run(truths, 5));
  });

  it('copes with one bar, two bars and none', () => {
    expect(solveChain([])).toEqual([]);
    expect(solveChain([bar(0.04, { strong: true })])[0].offset).toBeCloseTo(0.04, 2);
    const two = solveChain([bar(0.04, { strong: true }), bar(0.04)]);
    expect(Math.abs(two[1].offset - 0.04)).toBeLessThan(0.1);
  });
});
