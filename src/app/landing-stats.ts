import type { LandingReport } from '../audio/user-audio';

/** How jumps have landed so far in one group: how many, how far off on average, and the worst. */
export interface LandingGroup {
  readonly count: number;
  readonly total: number;
  readonly max: number;
}

/** The session's landings, kept apart by whether the element that landed seeks exactly, so the effect of the exact copy can be seen. */
export interface LandingStats {
  /** Landings on the recording's own file, before an exact copy was in use. */
  readonly before: LandingGroup;
  /** Landings on an exact copy, or on a file that is exact already. */
  readonly after: LandingGroup;
}

const none: LandingGroup = { count: 0, total: 0, max: 0 };
export const emptyLandingStats: LandingStats = { before: none, after: none };

const add = (group: LandingGroup, error: number): LandingGroup => ({ count: group.count + 1, total: group.total + error, max: Math.max(group.max, error) });

/** The stats with one more landing counted in its group. */
export function addLanding(stats: LandingStats, report: Pick<LandingReport, 'error' | 'exact'>): LandingStats {
  return report.exact ? { ...stats, after: add(stats.after, report.error) } : { ...stats, before: add(stats.before, report.error) };
}

const seconds = (value: number): string => `${value.toFixed(value < 0.1 ? 3 : 2)} s`;

function describeGroup(label: string, group: LandingGroup): string {
  return `${label}: ${group.count} ${group.count === 1 ? 'jump' : 'jumps'}, ${seconds(group.total / group.count)} off on average, up to ${seconds(group.max)}.`;
}

/** One sentence for each group that has landings; empty when no jump has landed yet. */
export function describeLandings(stats: LandingStats): string[] {
  const lines: string[] = [];
  if (stats.before.count > 0) lines.push(describeGroup('Before the exact copy was ready', stats.before));
  if (stats.after.count > 0) lines.push(describeGroup('On the exact copy', stats.after));
  return lines;
}
