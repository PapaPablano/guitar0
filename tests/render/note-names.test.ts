import { describe, expect, it } from 'vitest';
import { noteName, spellingForTuning } from '../../src/render/note-names';

const STANDARD = [64, 59, 55, 50, 45, 40]; // E B G D A E, highest string first
const HALF_STEP_DOWN = STANDARD.map((m) => m - 1); // Eb Bb Gb Db Ab Eb
const DROP_D = [64, 59, 55, 50, 45, 38];

describe('spellingForTuning', () => {
  it('uses sharps for standard tuning and drop D, which have no black-key open strings', () => {
    expect(spellingForTuning(STANDARD)).toBe('sharps');
    expect(spellingForTuning(DROP_D)).toBe('sharps');
  });

  it('uses flats for a tuning with black-key open strings, such as a half step down', () => {
    expect(spellingForTuning(HALF_STEP_DOWN)).toBe('flats');
  });

  it('falls back to sharps with no tuning', () => {
    expect(spellingForTuning([])).toBe('sharps');
  });
});

describe('noteName', () => {
  it('names the open strings of standard tuning', () => {
    expect(STANDARD.map((m) => noteName(m, 'sharps'))).toEqual(['E', 'B', 'G', 'D', 'A', 'E']);
  });

  it('names the open strings a half step down with flats', () => {
    expect(HALF_STEP_DOWN.map((m) => noteName(m, 'flats'))).toEqual(['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb']);
  });

  it('names fretted notes in either spelling', () => {
    expect(noteName(45 + 6, 'sharps')).toBe('D#');
    expect(noteName(45 + 6, 'flats')).toBe('Eb');
    expect(noteName(64 + 12, 'sharps')).toBe('E');
  });

  it('keeps names in range for any midi number', () => {
    expect(noteName(0, 'sharps')).toBe('C');
    expect(noteName(127, 'sharps')).toBe('G');
  });
});
