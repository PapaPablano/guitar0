import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { measureLevels, referenceRiff, rms } from '../../src/audio/bank-levels';
import { BUNDLED_BANKS } from '../../src/audio/bank-manifest';
import { buildSoundFont } from '../fixtures/soundfonts';

describe('rms', () => {
  const sine = (amplitude: number, length: number, offset = 0) =>
    Float32Array.from({ length }, (_, i) => amplitude * Math.sin((2 * Math.PI * (i + offset)) / 100));

  it('gives amplitude over root two for a whole number of sine cycles', () => {
    expect(rms(sine(0.5, 44100))).toBeCloseTo(0.5 / Math.SQRT2, 6);
  });

  it('treats several buffers as one signal', () => {
    expect(rms(sine(0.5, 300), sine(0.5, 700, 300))).toBeCloseTo(0.5 / Math.SQRT2, 6);
    expect(rms(new Float32Array([1, 1]), new Float32Array([0, 0]))).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('is 0 for silence and for no samples at all', () => {
    expect(rms(new Float32Array(10))).toBe(0);
    expect(rms()).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe('referenceRiff', () => {
  const notes = (program: number) =>
    referenceRiff(program)
      .events.filter((e): e is alphaTab.midi.NoteOnEvent => e instanceof alphaTab.midi.NoteOnEvent)
      .map((e) => e.noteKey);

  it('is the same riff for every guitar, and an octave lower for bass', () => {
    expect(notes(30)).toEqual(notes(24));
    expect(notes(33)).toEqual(notes(30).map((key) => key - 12));
    expect(notes(30).length).toBeGreaterThan(4);
  });
});

describe('measureLevels in a real alphaTab synth', () => {
  it('hears a program the bank covers and not one it lacks', () => {
    // Six zones cover keys 0 to 59, which takes in the riff's guitar and bass notes.
    const bank = buildSoundFont([{ name: 'Clean Gtr', bank: 0, program: 27, samples: ['mono', 'mono', 'mono', 'mono', 'mono', 'mono'] }]);
    const levels = measureLevels([bank], [27, 30]);
    expect(levels[27]).toBeGreaterThan(0.001);
    expect(levels[30]).toBeLessThan(1e-6);
  });

  // About 2 s: it parses the 40 MB bundled bank once per program.
  it("reproduces MuseScore General's level table", { timeout: 30_000 }, () => {
    const bank = new Uint8Array(readFileSync(new URL('../../assets/soundfont/MuseScore_General.sf3', import.meta.url)));
    const stored = BUNDLED_BANKS.find((b) => b.id === 'musescore-general')!.levels;
    const programs = [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34];
    const measured = measureLevels([bank], programs);
    for (const program of programs) {
      const db = 20 * Math.log10(measured[program] / stored[program]!);
      // Guitars 24 to 31 keep the numbers measured with the earlier riff; that riff was not kept, and this one lands within
      // 2 dB of every one (the palm-muted 28 is the farthest). Bass was measured with this riff and must match to rounding.
      expect(Math.abs(db), `program ${program}`).toBeLessThan(program >= 32 ? 0.05 : 2);
    }
  });
});
