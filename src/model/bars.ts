import type { Timeline } from './score';

/** Index of the played bar containing time `t`: the last bar that starts at or before it. */
export function playbackBarIndexAt(timeline: Timeline, t: number): number {
  const bars = timeline.bars;
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].startSeconds <= t) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}
