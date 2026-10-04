import type { BarEvent, NoteEvent, TempoPoint, Timeline, TrackInfo } from './score';

/** A Timeline reduced to plain data, so it can be sent to a worker (a Timeline holds a function). */
export interface TimelineData {
  readonly title: string;
  readonly tracks: readonly TrackInfo[];
  readonly bars: readonly BarEvent[];
  readonly tempoMap: readonly TempoPoint[];
  readonly durationSeconds: number;
  readonly scoreBarCount: number;
  /** Notes keyed by track index. */
  readonly notes: Readonly<Record<number, readonly NoteEvent[]>>;
}

/** Plain data for one track: what the exporter needs to draw it. */
export function serializeTimeline(timeline: Timeline, trackIndex: number): TimelineData {
  return {
    title: timeline.title,
    tracks: timeline.tracks,
    bars: timeline.bars,
    tempoMap: timeline.tempoMap,
    durationSeconds: timeline.durationSeconds,
    scoreBarCount: timeline.scoreBarCount,
    notes: { [trackIndex]: timeline.notesForTrack(trackIndex) },
  };
}

export function hydrateTimeline(data: TimelineData): Timeline {
  return {
    title: data.title,
    tracks: data.tracks,
    bars: data.bars,
    tempoMap: data.tempoMap,
    durationSeconds: data.durationSeconds,
    scoreBarCount: data.scoreBarCount,
    notesForTrack: (index: number) => data.notes[index] ?? [],
  };
}
