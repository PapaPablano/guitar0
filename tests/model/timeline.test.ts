import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildTimeline, loadAlphaTex, loadScoreFromBytes, ticksToSeconds } from '../../src/model/alphatab-adapter';
import {
  MUSICXML_NO_TAB,
  MUSICXML_WITH_TAB,
  REPEAT_AND_TEMPO,
  STEADY,
  TECHNIQUES,
  TWO_TRACKS,
} from '../fixtures/fixtures';

const xml = (text: string) => new TextEncoder().encode(text);

describe('ticksToSeconds', () => {
  it('integrates across tempo points', () => {
    const map = [
      { tick: 0, tempo: 120 },
      { tick: 960, tempo: 60 },
    ];
    expect(ticksToSeconds(map, 960)).toBeCloseTo(0.5, 9);
    expect(ticksToSeconds(map, 1920)).toBeCloseTo(1.5, 9);
  });
});

describe('buildTimeline timing', () => {
  it('matches hand-computed times for a steady tempo', () => {
    const t = buildTimeline(loadAlphaTex(STEADY));
    const notes = t.notesForTrack(0);
    expect(notes).toHaveLength(16);
    // 100 bpm: a quarter note lasts 0.6 s
    notes.forEach((n, i) => {
      expect(Math.abs(n.startSeconds - i * 0.6)).toBeLessThan(0.001);
      expect(Math.abs(n.endSeconds - (i + 1) * 0.6)).toBeLessThan(0.001);
    });
    expect(t.durationSeconds).toBeCloseTo(9.6, 6);
  });

  it('plays repeats again in playback order with matching score bars', () => {
    const t = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    expect(t.bars.map((b) => b.scoreBar)).toEqual([0, 1, 2, 0, 1, 2, 3]);
    const notes = t.notesForTrack(0);
    expect(notes).toHaveLength(28);
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].startSeconds).toBeGreaterThan(notes[i - 1].startSeconds);
    }
    // the second pass of bar 0 starts after three 2 s bars
    expect(notes[12].scoreBar).toBe(0);
    expect(notes[12].startSeconds).toBeCloseTo(6, 6);
  });

  it('applies a mid-song tempo change to later bars', () => {
    const t = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const last = t.bars[t.bars.length - 1];
    expect(last.tempo).toBe(60);
    expect(last.startSeconds).toBeCloseTo(12, 6);
    expect(last.endSeconds - last.startSeconds).toBeCloseTo(4, 6);
    expect(t.durationSeconds).toBeCloseTo(16, 6);
  });

  it('uses the default tempo when the score has none', () => {
    const t = buildTimeline(loadAlphaTex(String.raw`:4 3.1 3.1 3.1 3.1`));
    expect(t.bars[0].tempo).toBe(120);
    expect(t.durationSeconds).toBeCloseTo(2, 6);
  });
});

describe('buildTimeline model', () => {
  it('returns each track its own events', () => {
    const t = buildTimeline(loadAlphaTex(TWO_TRACKS));
    expect(t.tracks.map((x) => x.name)).toEqual(['Lead', 'Rhythm']);
    expect(t.notesForTrack(0).map((n) => n.fret)).toEqual([3, 3, 3, 3]);
    expect(t.notesForTrack(1).map((n) => n.fret)).toEqual([0, 0, 0, 0]);
    expect(t.notesForTrack(5)).toEqual([]);
  });

  it('numbers strings from the highest pitched string and lists the tuning highest first', () => {
    const t = buildTimeline(loadAlphaTex(STEADY));
    expect(t.tracks[0].stringCount).toBe(6);
    // standard tuning, high E4 down to low E2
    expect(t.tracks[0].tuning).toEqual([64, 59, 55, 50, 45, 40]);
    expect(t.notesForTrack(0).every((n) => n.string === 1)).toBe(true);
  });

  it('reports techniques on notes', () => {
    const t = buildTimeline(loadAlphaTex(TECHNIQUES));
    const notes = t.notesForTrack(0);
    expect(notes[0].techniques.bend).toBeGreaterThan(0);
    expect(notes[1].techniques.slide).not.toBe('none');
    expect(notes.some((n) => n.techniques.palmMute)).toBe(true);
    expect(notes.some((n) => n.techniques.harmonic)).toBe(true);
    expect(notes.some((n) => n.techniques.dead)).toBe(true);
    expect(notes[notes.length - 1].techniques.bend).toBe(0);
  });

  it('is immutable', () => {
    const t = buildTimeline(loadAlphaTex(STEADY));
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.notesForTrack(0))).toBe(true);
    expect(Object.isFrozen(t.notesForTrack(0)[0])).toBe(true);
  });
});

describe('MusicXML', () => {
  it('reads string and fret from technical notation', () => {
    const t = buildTimeline(loadScoreFromBytes(xml(MUSICXML_WITH_TAB)));
    expect(t.bars[0].tempo).toBe(90);
    const notes = t.notesForTrack(0);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ string: 6, fret: 0 });
    expect(notes[1]).toMatchObject({ string: 5, fret: 0 });
    expect(t.tracks[0].hasTabData).toBe(true);
  });

  it('assigns frets to pitch-only MusicXML and flags the track', () => {
    const t = buildTimeline(loadScoreFromBytes(xml(MUSICXML_NO_TAB)));
    const notes = t.notesForTrack(0);
    expect(notes).toHaveLength(1);
    expect(notes[0].fret).toBeGreaterThanOrEqual(0);
    expect(notes[0].string).toBeGreaterThanOrEqual(1);
    expect(t.tracks[0].hasTabData).toBe(false);
  });
});

describe('errors', () => {
  it('throws a catchable error on a corrupt file', () => {
    expect(() => loadScoreFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });
});

describe('library isolation', () => {
  it('keeps alphaTab out of the renderer and the score types', () => {
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) scan(path);
        else if (/\.(ts|tsx)$/.test(name) && /alphatab/i.test(readFileSync(path, 'utf8').replace(/^\s*\/\/.*$/gm, ''))) {
          offenders.push(path);
        }
      }
    };
    try {
      scan('src/render');
    } catch {
      // the renderer folder does not exist yet
    }
    expect(offenders).toEqual([]);
    expect(/alphatab/i.test(readFileSync('src/model/score.ts', 'utf8').replace(/^\s*\/\/.*$/gm, ''))).toBe(false);
  });
});
