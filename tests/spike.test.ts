import { describe, expect, it } from 'vitest';
import { dumpTimeline, loadAlphaTex, loadScoreFromBytes, ticksToSeconds } from '../src/model/spike';
import { MUSICXML_WITH_TAB, REPEAT_AND_TEMPO, STEADY } from './fixtures/fixtures';

describe('alphaTab timing spike (U1)', () => {
  it('dumps repeated bars once per pass in playback order with increasing times', () => {
    const beats = dumpTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    // bars 0-2 play twice, then bar 3 once: 7 played bars x 4 beats
    expect(beats).toHaveLength(28);
    expect(beats.map((b) => b.scoreBar).filter((_, i) => i % 4 === 0)).toEqual([0, 1, 2, 0, 1, 2, 3]);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i].seconds).toBeGreaterThan(beats[i - 1].seconds);
    }
  });

  it('shows the gap implied by a mid-song tempo change', () => {
    const beats = dumpTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    // at 120 bpm a quarter is 0.5 s, at 60 bpm it is 1.0 s
    const firstBar = beats.slice(0, 4);
    expect(firstBar[1].seconds - firstBar[0].seconds).toBeCloseTo(0.5, 6);
    const last = beats.slice(-4);
    expect(last[0].tempo).toBe(60);
    expect(last[1].seconds - last[0].seconds).toBeCloseTo(1.0, 6);
    // six bars at 120 bpm (2 s each) lead into the 60 bpm bar
    expect(last[0].seconds).toBeCloseTo(12, 6);
  });

  it('matches a hand-computed time for a steady tempo', () => {
    const beats = dumpTimeline(loadAlphaTex(STEADY));
    expect(beats).toHaveLength(16);
    // 100 bpm: one quarter = 0.6 s, so beat 15 starts at 9.0 s
    expect(beats[15].seconds).toBeCloseTo(9.0, 6);
  });

  it('converts ticks to seconds across tempo points', () => {
    const map = [
      { tick: 0, tempo: 120 },
      { tick: 960, tempo: 60 },
    ];
    expect(ticksToSeconds(map, 960)).toBeCloseTo(0.5, 6);
    expect(ticksToSeconds(map, 1920)).toBeCloseTo(1.5, 6);
  });

  it('reads string and fret from MusicXML technical notation', () => {
    const bytes = new TextEncoder().encode(MUSICXML_WITH_TAB);
    const beats = dumpTimeline(loadScoreFromBytes(bytes));
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats[0].notes).toHaveLength(1);
    expect(beats[0].tempo).toBe(90);
  });

  it('throws a catchable error on a corrupt file', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => loadScoreFromBytes(garbage)).toThrow();
  });
});
