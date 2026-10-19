import type { NoteEvent } from '../model/score';

const maxDurationCache = new WeakMap<readonly NoteEvent[], number>();

/** The longest note of a track, so a window scan knows how far back a held note can have started. */
function maxDuration(notes: readonly NoteEvent[]): number {
  let cached = maxDurationCache.get(notes);
  if (cached === undefined) {
    cached = 0;
    for (const n of notes) cached = Math.max(cached, n.endSeconds - n.startSeconds);
    maxDurationCache.set(notes, cached);
  }
  return cached;
}

/** First index whose start is at or after `time`; notes are sorted by start. */
function lowerBound(notes: readonly NoteEvent[], time: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startSeconds < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Notes whose body overlaps the time window from `from` to `to`, in start order. */
export function visibleNotes(notes: readonly NoteEvent[], from: number, to: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let i = lowerBound(notes, from - maxDuration(notes)); i < notes.length; i++) {
    const n = notes[i];
    if (n.startSeconds > to) break;
    if (n.endSeconds >= from) out.push(n);
  }
  return out;
}
