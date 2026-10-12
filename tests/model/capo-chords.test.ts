import { describe, expect, it } from 'vitest';
import { assignFret } from '../../src/model/alphatab-adapter';
import { dotText } from '../../src/render/fretboard';
import { spellingForTuning } from '../../src/render/note-names';
import { makeTimeline } from '../helpers/make-timeline';

const STANDARD = [64, 59, 55, 50, 45, 40];

describe('assignFret', () => {
  it('skips the strings a chord already uses', () => {
    expect(assignFret(STANDARD, 64)).toEqual({ string: 1, fret: 0 });
    expect(assignFret(STANDARD, 64, new Set([1]))).toEqual({ string: 2, fret: 5 });
  });

  it('gives no place when every string that reaches the pitch is used', () => {
    expect(assignFret(STANDARD, 40, new Set([6]))).toBeNull();
  });
});

describe('note names with a capo', () => {
  const naming = (capo: number) => ({ mode: 'note' as const, tuning: STANDARD, capo, spelling: spellingForTuning(STANDARD) });

  it('names a note by its sounding pitch, capo included', () => {
    const [note] = makeTimeline([{ start: 0, end: 1, string: 2, fret: 1 }]).notesForTrack(0);
    expect(dotText(note, naming(0)).main).toBe('C');
    expect(dotText(note, naming(2)).main).toBe('D');
  });
});
