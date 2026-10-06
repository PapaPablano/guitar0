import { describe, expect, it } from 'vitest';
import { addLanding, describeLandings, emptyLandingStats } from '../../src/app/landing-stats';

describe('landing stats', () => {
  it('covers AE6: keeps jumps made before and after the copy was ready in separate groups, each with its own mean and worst', () => {
    let stats = emptyLandingStats;
    for (const error of [0.2, 0.4, 0.9]) stats = addLanding(stats, { error, exact: false });
    for (const error of [0.004, 0.012]) stats = addLanding(stats, { error, exact: true });
    expect(stats.before).toEqual({ count: 3, total: expect.closeTo(1.5, 9), max: 0.9 });
    expect(stats.after).toEqual({ count: 2, total: expect.closeTo(0.016, 9), max: 0.012 });
  });

  it('describes each group that has landings, and only those', () => {
    const onlyAfter = addLanding(emptyLandingStats, { error: 0.01, exact: true });
    expect(describeLandings(onlyAfter)).toEqual(['On the exact copy: 1 jump, 0.010 s off on average, up to 0.010 s.']);
    const both = addLanding(addLanding(onlyAfter, { error: 0.5, exact: false }), { error: 0.7, exact: false });
    const lines = describeLandings(both);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Before the exact copy was ready: 2 jumps, 0.60 s off on average, up to 0.70 s.');
  });

  it('says nothing before any jump has landed', () => {
    expect(describeLandings(emptyLandingStats)).toEqual([]);
  });

  it('does not change the stats it was given', () => {
    const before = emptyLandingStats;
    addLanding(before, { error: 1, exact: false });
    expect(before.before.count).toBe(0);
  });
});
