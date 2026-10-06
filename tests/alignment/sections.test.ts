import { describe, expect, it } from 'vitest';
import { chromaFrames, FEATURE_RATE as R } from '../../src/alignment/features';
import { MAX_SECTIONS, MIN_SECTION_BARS, findSections, mergeNeighbours } from '../../src/alignment/sections';
import { bandPerformance, barSpans, renderSong, silence, songNotes, structuredSong, type SongNote } from '../helpers/synthetic-audio';

const BAR = 2;

/** Sections of a recording made by playing `notes` steadily for `bars` bars, with the true anchors of a steady band. */
function sectionsOf(notes: SongNote[], bars: number, timbre: 'plain' | 'rich' = 'rich', lengths?: number[]) {
  const spans = barSpans(bars, BAR);
  const played = bandPerformance(notes, spans, lengths ?? spans.map(() => BAR), 0);
  const recording = renderSong(played.notes, played.seconds, R, timbre, 9);
  return findSections(chromaFrames(recording, R), spans, played.anchors, played.endAnchor);
}

describe('findSections', { timeout: 60000 }, () => {
  it('covers AE5: verse, chorus, verse, chorus and solo give five sections lettered A, B, A, B, C at the true boundaries', () => {
    const sections = sectionsOf(structuredSong('ABABC', 8), 40);
    expect(sections.map((s) => s.letter)).toEqual(['A', 'B', 'A', 'B', 'C']);
    sections.forEach((s, i) => {
      expect(Math.abs(s.firstBar - i * 8)).toBeLessThanOrEqual(1);
    });
    expect(sections[0].firstBar).toBe(0);
    expect(sections[sections.length - 1].lastBar).toBe(39);
    // the sections tile the song with no gap and no overlap
    for (let i = 1; i < sections.length; i++) expect(sections[i].firstBar).toBe(sections[i - 1].lastBar + 1);
  });

  it('gives the same sections for the same song in a plain and a rich timbre', () => {
    const song = structuredSong('ABAB', 8);
    expect(sectionsOf(song, 32, 'plain')).toEqual(sectionsOf(song, 32, 'rich'));
  });

  it('gives one section for a song with no repetition or change to find', () => {
    const chord = (start: number): SongNote[] => [48, 52, 55].map((midi) => ({ start, duration: 1.9, midi }));
    const steady = Array.from({ length: 24 }, (_, k) => chord(k * BAR)).flat();
    expect(sectionsOf(steady, 24)).toEqual([{ firstBar: 0, lastBar: 23, letter: 'A' }]);
  });

  it('never makes a section shorter than four bars or more than twelve of them', () => {
    const varied = songNotes(48, BAR, 77);
    const sections = sectionsOf(varied, 48);
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections.length).toBeLessThanOrEqual(MAX_SECTIONS);
    for (const s of sections) expect(s.lastBar - s.firstBar + 1).toBeGreaterThanOrEqual(MIN_SECTION_BARS);
  });

  it('keeps a bar of extra playing inside its section and finds the same boundaries', () => {
    const song = structuredSong('ABAB', 8);
    const lengths = Array.from({ length: 32 }, () => BAR);
    lengths[11] += 8; // a long bar in the middle of the first chorus
    const sections = sectionsOf(song, 32, 'rich', lengths);
    expect(sections.map((s) => s.letter)).toEqual(['A', 'B', 'A', 'B']);
    sections.forEach((s, i) => expect(Math.abs(s.firstBar - i * 8)).toBeLessThanOrEqual(1));
  });

  it('never throws and gives one section for too little to look at', () => {
    const none = findSections(chromaFrames(new Float32Array(0), R), [], [], 0);
    expect(none).toEqual([]);
    const one = findSections(chromaFrames(renderSong(songNotes(1, BAR, 3), 2, R), R), barSpans(1, BAR), [0], 2);
    expect(one).toEqual([{ firstBar: 0, lastBar: 0, letter: 'A' }]);
    const quiet = findSections(chromaFrames(silence(20, R), R), barSpans(10, BAR), Array.from({ length: 10 }, (_, k) => k * BAR), 20);
    expect(quiet).toEqual([{ firstBar: 0, lastBar: 9, letter: 'A' }]);
    // anchors that all coincide, as for a recording that skips everything
    const stacked = findSections(chromaFrames(renderSong(songNotes(10, BAR, 3), 20, R), R), barSpans(10, BAR), Array.from({ length: 10 }, () => 3), 3);
    expect(stacked).toEqual([{ firstBar: 0, lastBar: 9, letter: 'A' }]);
  });
});

describe('mergeNeighbours', () => {
  it('joins neighbours that share a letter and leaves repeats that are apart', () => {
    const merged = mergeNeighbours([
      { firstBar: 0, lastBar: 7, letter: 'A' },
      { firstBar: 8, lastBar: 12, letter: 'B' },
      { firstBar: 13, lastBar: 15, letter: 'B' },
      { firstBar: 16, lastBar: 23, letter: 'A' },
    ]);
    expect(merged).toEqual([
      { firstBar: 0, lastBar: 7, letter: 'A' },
      { firstBar: 8, lastBar: 15, letter: 'B' },
      { firstBar: 16, lastBar: 23, letter: 'A' },
    ]);
  });
});
