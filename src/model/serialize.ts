import type { BarEvent, NoteEvent, TempoPoint, Timeline, TrackInfo } from './score';

/** A Timeline reduced to plain data, so it can be sent to a worker (a Timeline holds a function). */
export interface TimelineData {
  readonly title: string;
  readonly artist: string;
  readonly tracks: readonly TrackInfo[];
  readonly bars: readonly BarEvent[];
  readonly tempoMap: readonly TempoPoint[];
  readonly durationSeconds: number;
  readonly scoreBarCount: number;
  /** Notes keyed by track index. */
  readonly notes: Readonly<Record<number, readonly NoteEvent[]>>;
}

/** Plain data for the given track or tracks: what the exporter needs to draw them. */
export function serializeTimeline(timeline: Timeline, trackIndex: number | readonly number[]): TimelineData {
  const indexes = typeof trackIndex === 'number' ? [trackIndex] : [...new Set(trackIndex)];
  return {
    title: timeline.title,
    artist: timeline.artist,
    tracks: timeline.tracks,
    bars: timeline.bars,
    tempoMap: timeline.tempoMap,
    durationSeconds: timeline.durationSeconds,
    scoreBarCount: timeline.scoreBarCount,
    notes: Object.fromEntries(indexes.map((i) => [i, timeline.notesForTrack(i)])),
  };
}

export function hydrateTimeline(data: TimelineData): Timeline {
  return {
    title: data.title,
    artist: data.artist,
    tracks: data.tracks,
    bars: data.bars,
    tempoMap: data.tempoMap,
    durationSeconds: data.durationSeconds,
    scoreBarCount: data.scoreBarCount,
    notesForTrack: (index: number) => data.notes[index] ?? [],
  };
}
