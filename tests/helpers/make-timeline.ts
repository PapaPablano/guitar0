import type { BarEvent, NoteEvent, Techniques, Timeline, TrackInfo } from '../../src/model/score';

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
}

/** Builds a Timeline by hand, with no alphaTab involved, for renderer tests. */
export function makeTimeline(specs: NoteSpec[], barSeconds = 2, bars = 4): Timeline {
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
    stringCount: 6,
    tuning: [64, 59, 55, 50, 45, 40],
    hasTabData: true,
    isPercussion: false,
  };
  return {
    title: 'test',
    tracks: [track],
    bars: barEvents,
    tempoMap: [{ tick: 0, tempo: 120 }],
    durationSeconds: bars * barSeconds,
    scoreBarCount: bars,
    notesForTrack: (i) => (i === 0 ? notes : []),
  };
}
