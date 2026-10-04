// Note names for the fretboard. Pitches are midi numbers; names carry no octave.

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
/** Pitch classes that are black keys: C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb. */
const ACCIDENTAL_CLASSES = new Set([1, 3, 6, 8, 10]);

export type NoteSpelling = 'sharps' | 'flats';

/**
 * How to spell the accidentals for a tuning. Standard tuning (E A D G B E) and drop D have none on
 * the open strings and read with sharps, as tab usually does; a tuning with a black-key open
 * string, such as everything down a half step (Eb Ab Db Gb Bb Eb), reads with flats.
 */
export function spellingForTuning(tuning: readonly number[]): NoteSpelling {
  return tuning.some((midi) => ACCIDENTAL_CLASSES.has(((midi % 12) + 12) % 12)) ? 'flats' : 'sharps';
}

export function noteName(midi: number, spelling: NoteSpelling): string {
  const names = spelling === 'flats' ? FLAT_NAMES : SHARP_NAMES;
  return names[((Math.round(midi) % 12) + 12) % 12];
}
