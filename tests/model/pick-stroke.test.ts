import { describe, expect, it } from 'vitest';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';

/** Four quarter-note beats: one marked up, one marked down, one a chord marked up, one unmarked. */
const MARKED = String.raw`\title "strokes" \tempo 120 :4 3.3{sd} 5.3{su} (3.2 3.3){su} 7.3`;

describe('pick strokes from the file', () => {
  const notes = buildTimeline(loadAlphaTex(MARKED)).notesForTrack(0);

  it('reads a down and an up stroke from the beat', () => {
    expect(notes[0].stroke).toBe('down');
    expect(notes[1].stroke).toBe('up');
  });

  it('gives every note of a chord the stroke of its beat', () => {
    const chord = notes.filter((n) => n.tick === notes[2].tick);
    expect(chord).toHaveLength(2);
    expect(chord.map((n) => n.stroke)).toEqual(['up', 'up']);
  });

  it('marks a beat the file leaves unmarked as none', () => {
    expect(notes[notes.length - 1].stroke).toBe('none');
  });
});
