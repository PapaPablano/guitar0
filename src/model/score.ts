// Our own score and timeline types. Nothing in this file (or anything that imports only from it)
// depends on alphaTab, so the renderers stay independent of the parsing library (KTD2).

export type SlideKind = 'none' | 'shift' | 'legato' | 'out-down' | 'out-up' | 'in-below' | 'in-above';

export interface Techniques {
  /** Largest bend in semitones; 0 when the note is not bent. */
  readonly bend: number;
  readonly slide: SlideKind;
  /** Hammer-on or pull-off: the note starts one (origin) or ends one (destination). */
  readonly hammerPull: 'none' | 'origin' | 'destination';
  readonly palmMute: boolean;
  readonly harmonic: boolean;
  readonly dead: boolean;
  readonly ghost: boolean;
  readonly letRing: boolean;
  readonly vibrato: boolean;
  /** The note continues a tied note rather than being plucked. */
  readonly tied: boolean;
}

export interface NoteEvent {
  /** Stable id, unique within a timeline. */
  readonly id: string;
  readonly trackIndex: number;
  /** 1 is the highest-pitched string, as in printed tab. */
  readonly string: number;
  readonly fret: number;
  /** Midi tick of the start in the playback sequence (repeats counted again). */
  readonly tick: number;
  readonly durationTicks: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** Index of the played bar in playback order. */
  readonly playbackBar: number;
  /** Bar index in score order, for placing the tab cursor across repeats. */
  readonly scoreBar: number;
  readonly techniques: Techniques;
}

export interface BarEvent {
  readonly playbackIndex: number;
  readonly scoreBar: number;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly tempo: number;
  readonly timeSignature: { readonly numerator: number; readonly denominator: number };
}

export interface TrackInfo {
  readonly index: number;
  readonly name: string;
  readonly stringCount: number;
  /** Open-string midi pitches, highest-pitched string first. */
  readonly tuning: readonly number[];
  /** False when the track carries pitches only; frets were then assigned by the parser. */
  readonly hasTabData: boolean;
  readonly isPercussion: boolean;
}

export interface TempoPoint {
  readonly tick: number;
  readonly tempo: number;
}

export interface Timeline {
  readonly title: string;
  readonly tracks: readonly TrackInfo[];
  readonly bars: readonly BarEvent[];
  readonly tempoMap: readonly TempoPoint[];
  readonly durationSeconds: number;
  /** Number of bars in score order. */
  readonly scoreBarCount: number;
  /** Notes of one track, ordered by start time. */
  notesForTrack(trackIndex: number): readonly NoteEvent[];
}
