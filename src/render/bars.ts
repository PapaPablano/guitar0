import type { BarEvent, Timeline } from '../model/score';

/** One score bar, with the pass of the song that plays it first. */
export interface BarSpan {
  readonly scoreBar: number;
  /** The first time this bar is played; repeats reuse its notes. */
  readonly playback: BarEvent;
  readonly repeatStart: boolean;
  readonly repeatEnd: boolean;
}

/**
 * The score's bars in score order, each with its first playback occurrence and whether a repeat
 * starts or ends there. A repeat shows up in playback order as a jump back to an earlier bar.
 */
export function barSpans(timeline: Timeline): BarSpan[] {
  const firstPlayback = new Map<number, BarEvent>();
  const repeatEnds = new Set<number>();
  const repeatStarts = new Set<number>();
  timeline.bars.forEach((bar, i) => {
    if (!firstPlayback.has(bar.scoreBar)) firstPlayback.set(bar.scoreBar, bar);
    const next = timeline.bars[i + 1];
    if (next && next.scoreBar <= bar.scoreBar) {
      repeatEnds.add(bar.scoreBar);
      repeatStarts.add(next.scoreBar);
    }
  });

  const spans: BarSpan[] = [];
  for (let scoreBar = 0; scoreBar < timeline.scoreBarCount; scoreBar++) {
    const playback = firstPlayback.get(scoreBar);
    if (!playback) continue;
    spans.push({
      scoreBar,
      playback,
      repeatStart: repeatStarts.has(scoreBar),
      repeatEnd: repeatEnds.has(scoreBar),
    });
  }
  return spans;
}
