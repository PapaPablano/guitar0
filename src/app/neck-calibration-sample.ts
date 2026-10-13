import type { BarEvent, NoteEvent, PickStroke, Techniques, Timeline, TrackInfo } from '../model/score';

const PLAIN: Techniques = {
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

interface Spec {
  start: number;
  end: number;
  string: number;
  fret: number;
  techniques?: Partial<Techniques>;
  stroke?: PickStroke;
}

/** A chord, a run of single notes picked down and up, an up-stroke chord and a hammer-on: every effect the pick view draws. */
const SAMPLE: readonly Spec[] = [
  ...[[3, 5], [4, 7], [5, 7]].map(([string, fret]): Spec => ({ start: 0, end: 0.9, string, fret })),
  { start: 1, end: 1.2, string: 2, fret: 8 },
  { start: 1.25, end: 1.45, string: 3, fret: 7 },
  { start: 1.5, end: 1.7, string: 2, fret: 8 },
  { start: 1.75, end: 1.95, string: 3, fret: 7 },
  ...[[1, 5], [2, 5], [3, 5]].map(([string, fret]): Spec => ({ start: 2, end: 2.9, string, fret, stroke: 'up' })),
  { start: 3, end: 3.4, string: 3, fret: 5, techniques: { hammerPull: 'origin' } },
  { start: 3.4, end: 3.9, string: 3, fret: 7, techniques: { hammerPull: 'destination' } },
];

const BAR_SECONDS = 2;
const BARS = 2;
const TICKS_PER_SECOND = 1920;

/** A four-second loop for the calibration preview, built by hand so it needs no file. */
export function makeSampleTimeline(): Timeline {
  const notes: NoteEvent[] = SAMPLE.map((s, i) =>
    Object.freeze({
      id: `sample${i}`,
      trackIndex: 0,
      string: s.string,
      fret: s.fret,
      tick: Math.round(s.start * TICKS_PER_SECOND),
      durationTicks: Math.round((s.end - s.start) * TICKS_PER_SECOND),
      startSeconds: s.start,
      endSeconds: s.end,
      playbackBar: Math.floor(s.start / BAR_SECONDS),
      scoreBar: Math.floor(s.start / BAR_SECONDS),
      techniques: Object.freeze({ ...PLAIN, ...s.techniques }),
      ...(s.stroke ? { stroke: s.stroke } : {}),
    }),
  ).sort((a, b) => a.startSeconds - b.startSeconds || a.string - b.string);
  const bars: BarEvent[] = Array.from({ length: BARS }, (_, i) => ({
    playbackIndex: i,
    scoreBar: i,
    startSeconds: i * BAR_SECONDS,
    endSeconds: (i + 1) * BAR_SECONDS,
    startTick: i * BAR_SECONDS * TICKS_PER_SECOND,
    endTick: (i + 1) * BAR_SECONDS * TICKS_PER_SECOND,
    tempo: 120,
    timeSignature: { numerator: 4, denominator: 4 },
  }));
  const track: TrackInfo = {
    index: 0,
    name: 'Sample',
    stringCount: 6,
    tuning: [64, 59, 55, 50, 45, 40],
    hasTabData: true,
    isPercussion: false,
    program: 30,
  };
  return {
    title: 'Calibration sample',
    artist: '',
    tracks: [track],
    bars,
    tempoMap: [{ tick: 0, tempo: 120 }],
    durationSeconds: BARS * BAR_SECONDS,
    scoreBarCount: BARS,
    notesForTrack: (i) => (i === 0 ? notes : []),
  };
}
