// Re-fretting a track for a different tuning. The pitches stay exactly as they are, so the sound is
// untouched; only the string and fret each note is shown on change.

import type { NoteEvent, Timeline, TrackInfo } from './score';

export interface TuningPreset {
  readonly id: string;
  readonly name: string;
  /** Open-string midi pitches, highest-pitched string first. */
  readonly tuning: readonly number[];
}

export const MAX_FRET = 24;

export const TUNING_PRESETS: readonly TuningPreset[] = [
  { id: 'standard', name: 'Standard (E A D G B E)', tuning: [64, 59, 55, 50, 45, 40] },
  { id: 'half-down', name: 'Half step down', tuning: [63, 58, 54, 49, 44, 39] },
  { id: 'full-down', name: 'Full step down', tuning: [62, 57, 53, 48, 43, 38] },
  { id: 'drop-d', name: 'Drop D', tuning: [64, 59, 55, 50, 45, 38] },
  { id: 'dadgad', name: 'DADGAD', tuning: [62, 57, 55, 50, 45, 38] },
  { id: 'open-g', name: 'Open G', tuning: [62, 59, 55, 50, 43, 38] },
];

/** Id meaning "show the file's own tuning". */
export const FILE_TUNING = 'file';

export function presetById(id: string): TuningPreset | undefined {
  return TUNING_PRESETS.find((p) => p.id === id);
}

export function sameTuning(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((m, i) => m === b[i]);
}

/** Presets a track can be shown in: those with its string count, standard first. */
export function presetsForTrack(track: TrackInfo | undefined): readonly TuningPreset[] {
  if (!track || track.isPercussion) return [];
  return TUNING_PRESETS.filter((p) => p.tuning.length === track.tuning.length);
}

/** The string (1 = highest) and fret for a pitch, nearest to `prefer`, avoiding `taken`; null if none fits. */
function place(
  pitch: number,
  tuning: readonly number[],
  prefer: number,
  taken: ReadonlySet<number>,
): { string: number; fret: number } | null {
  let best: { string: number; fret: number } | null = null;
  for (let s = 1; s <= tuning.length; s++) {
    if (taken.has(s)) continue;
    const fret = pitch - tuning[s - 1];
    if (fret < 0 || fret > MAX_FRET) continue;
    if (!best || Math.abs(s - prefer) < Math.abs(best.string - prefer)) best = { string: s, fret };
  }
  return best;
}

/** Octave shifts to try, nearest first. A pitch outside the new tuning's range is moved by octaves. */
const OCTAVE_TRIES = [0, 12, -12, 24, -24, 36, -36];

export function retuneNotes(notes: readonly NoteEvent[], from: readonly number[], to: readonly number[]): NoteEvent[] {
  let chordTick = Number.NaN;
  let taken = new Set<number>();
  return notes.map((note) => {
    if (note.tick !== chordTick) {
      chordTick = note.tick;
      taken = new Set();
    }
    const open = from[note.string - 1];
    if (open === undefined) return note;
    const pitch = open + note.fret;
    for (const shift of OCTAVE_TRIES) {
      const spot = place(pitch + shift, to, note.string, taken);
      if (!spot) continue;
      taken.add(spot.string);
      return spot.string === note.string && spot.fret === note.fret ? note : { ...note, ...spot };
    }
    return note;
  });
}

/**
 * The timeline with one track shown in another tuning: its tuning and every note's string and fret
 * change; timing, bars and the track's pitches do not.
 */
export function retuneTimeline(timeline: Timeline, trackIndex: number, tuning: readonly number[]): Timeline {
  const track = timeline.tracks[trackIndex];
  if (!track || sameTuning(track.tuning, tuning) || track.tuning.length !== tuning.length) return timeline;
  const retuned = retuneNotes(timeline.notesForTrack(trackIndex), track.tuning, tuning);
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => (t.index === trackIndex ? { ...t, tuning } : t)),
    notesForTrack: (index) => (index === trackIndex ? retuned : timeline.notesForTrack(index)),
  };
}
