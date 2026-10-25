import type { BarEvent, NoteEvent, PickStroke, Techniques, Timeline, TrackInfo } from '../../src/model/score';

export const PLAIN: Techniques = {
  bend: 0,
  slide: 'none',
  hammerPull: 'none',
  palmMute: false,
  harmonic: false,
  dead: false,
  ghost: false,
  letRing: false,
  vibrato: false,
  tied: false,
};

export interface NoteSpec {
  start: number;
  end: number;
  string?: number;
  fret?: number;
  techniques?: Partial<Techniques>;
  stroke?: PickStroke;
}

/** Builds a Timeline by hand, with no alphaTab involved, for renderer tests. */
export function makeTimeline(specs: NoteSpec[], barSeconds = 2, bars = 4, stringCount = 6): Timeline {
  const notes: NoteEvent[] = specs
    .map((s, i) => ({
      id: `n${i}`,
      trackIndex: 0,
      string: s.string ?? 1,
      fret: s.fret ?? 3,
      tick: Math.round(s.start * 1920),
      durationTicks: Math.round((s.end - s.start) * 1920),
      startSeconds: s.start,
      endSeconds: s.end,
      playbackBar: Math.floor(s.start / barSeconds),
      scoreBar: Math.floor(s.start / barSeconds),
      techniques: { ...PLAIN, ...s.techniques },
      ...(s.stroke ? { stroke: s.stroke } : {}),
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const barEvents: BarEvent[] = Array.from({ length: bars }, (_, i) => ({
    playbackIndex: i,
    scoreBar: i,
    startSeconds: i * barSeconds,
    endSeconds: (i + 1) * barSeconds,
    startTick: Math.round(i * barSeconds * 1920),
    endTick: Math.round((i + 1) * barSeconds * 1920),
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
  }));
  const track: TrackInfo = {
    index: 0,
    name: 'Guitar',
    stringCount,
    tuning: [64, 59, 55, 50, 45, 40, 35, 30].slice(0, stringCount),
    hasTabData: true,
    isPercussion: false,
    program: 30,
  };
  return {
    title: 'test',
    artist: '',
    tracks: [track],
    bars: barEvents,
    tempoMap: [{ tick: 0, tempo: 120 }],
    durationSeconds: bars * barSeconds,
    scoreBarCount: bars,
    notesForTrack: (i) => (i === 0 ? notes : []),
  };
}

/** A Timeline of two tracks: the first of `first` at index 0 and the first of `second` at index 1, on `first`'s bars. */
export function makeTwoTrackTimeline(first: Timeline, second: Timeline): Timeline {
  const second0 = second.notesForTrack(0).map((n) => ({ ...n, trackIndex: 1 }));
  return {
    ...first,
    tracks: [first.tracks[0], { ...second.tracks[0], index: 1, name: 'Bass' }],
    notesForTrack: (i) => (i === 0 ? first.notesForTrack(0) : i === 1 ? second0 : []),
  };
}
