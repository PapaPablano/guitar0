import type { Timeline } from '../model/score';

/** Index of the played bar containing time `t`. */
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

/** Start time of the previous (-1) or next (+1) played bar. */
export function seekByBar(timeline: Timeline, t: number, direction: -1 | 1): number {
  const bars = timeline.bars;
  if (bars.length === 0) return 0;
  const index = playbackBarIndexAt(timeline, t);
  const target = Math.min(bars.length - 1, Math.max(0, index + direction));
  return bars[target].startSeconds;
}

export type ShortcutAction =
  | 'toggle-play'
  | 'seek-back'
  | 'seek-forward'
  | 'tempo-up'
  | 'tempo-down'
  | 'toggle-loop';

export interface ShortcutTarget {
  readonly tag: string;
  readonly inputType?: string;
}

/**
 * Maps a key press to a practice action, or null. Shortcuts are suspended while a text field,
 * slider or select has focus, and Space is left to a focused button so it is not handled twice.
 */
export function interpretKey(key: string, target: ShortcutTarget): ShortcutAction | null {
  const tag = target.tag.toLowerCase();
  if (tag === 'textarea' || tag === 'select' || tag === 'input') return null;
  if (tag === 'button' && (key === ' ' || key === 'Enter')) return null;
  switch (key) {
    case ' ':
      return 'toggle-play';
    case 'ArrowLeft':
      return 'seek-back';
    case 'ArrowRight':
      return 'seek-forward';
    case 'ArrowUp':
      return 'tempo-up';
    case 'ArrowDown':
      return 'tempo-down';
    case 'l':
    case 'L':
      return 'toggle-loop';
    default:
      return null;
  }
}
