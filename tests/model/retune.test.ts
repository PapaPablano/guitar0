import { describe, expect, it } from 'vitest';
import { presetById, presetsForTrack, retuneTimeline } from '../../src/model/retune';
import { makeTimeline } from '../helpers/make-timeline';

const HALF_DOWN = [63, 58, 54, 49, 44, 39];
const std = presetById('standard')!.tuning;

function halfDown(specs: Parameters<typeof makeTimeline>[0]) {
  const base = makeTimeline(specs);
  return { ...base, tracks: [{ ...base.tracks[0], tuning: HALF_DOWN }] };
}

describe('retuneTimeline', () => {
  it('moves every fret down one when a half-step-down file is shown in standard', () => {
    const t = retuneTimeline(halfDown([{ start: 0, end: 1, string: 3, fret: 5 }, { start: 1, end: 2, string: 1, fret: 7 }]), 0, std);
    const notes = t.notesForTrack(0);
    expect(notes.map((n) => [n.string, n.fret])).toEqual([[3, 4], [1, 6]]);
    expect(t.tracks[0].tuning).toEqual(std);
  });

  it('keeps pitch, timing and ids', () => {
    const src = halfDown([{ start: 0, end: 1, string: 2, fret: 3 }]);
    const [a] = src.notesForTrack(0);
    const [b] = retuneTimeline(src, 0, std).notesForTrack(0);
    expect(HALF_DOWN[a.string - 1] + a.fret).toBe(std[b.string - 1] + b.fret);
    expect([b.id, b.startSeconds, b.tick]).toEqual([a.id, a.startSeconds, a.tick]);
  });

  it('moves an open string to a neighbouring string when its fret would be negative', () => {
    const [n] = retuneTimeline(halfDown([{ start: 0, end: 1, string: 1, fret: 0 }]), 0, std).notesForTrack(0);
    expect(std[n.string - 1] + n.fret).toBe(63);
    expect(n.fret).toBeGreaterThanOrEqual(0);
  });

  it('moves a note below the lowest string up an octave', () => {
    const [n] = retuneTimeline(halfDown([{ start: 0, end: 1, string: 6, fret: 0 }]), 0, std).notesForTrack(0);
    expect(std[n.string - 1] + n.fret).toBe(39 + 12);
  });

  it('keeps chord notes on different strings', () => {
    const notes = retuneTimeline(
      halfDown([
        { start: 0, end: 1, string: 1, fret: 0 },
        { start: 0, end: 1, string: 2, fret: 0 },
      ]),
      0,
      std,
    ).notesForTrack(0);
    expect(new Set(notes.map((n) => n.string)).size).toBe(2);
  });

  it('returns the same timeline when the tuning already matches', () => {
    const src = makeTimeline([{ start: 0, end: 1 }]);
    expect(retuneTimeline(src, 0, std)).toBe(src);
  });
});

describe('presetsForTrack', () => {
  it('omits the tuning the track already has and needs a matching string count', () => {
    const base = makeTimeline([]);
    expect(presetsForTrack(base.tracks[0]).map((p) => p.id)).not.toContain('standard');
    expect(presetsForTrack(base.tracks[0])).not.toHaveLength(0);
    expect(presetsForTrack({ ...base.tracks[0], tuning: [43, 38, 33, 28] })).toEqual([]);
  });
});
