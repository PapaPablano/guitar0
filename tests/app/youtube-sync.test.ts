import { describe, expect, it } from 'vitest';
import { firstNoteSeconds, syncHereOffset } from '../../src/app/youtube-sync';

describe('syncHereOffset', () => {
  it('sets the offset to the video position when the first note is at the tab start', () => {
    expect(syncHereOffset(7.5, 0)).toEqual({ ok: true, offset: 7.5 });
  });

  it('subtracts the tab time of the first note', () => {
    expect(syncHereOffset(7.5, 1)).toEqual({ ok: true, offset: 6.5 });
  });

  it('gives a negative offset when the video reaches the first note before the tab does', () => {
    expect(syncHereOffset(0.5, 2)).toEqual({ ok: true, offset: -1.5 });
  });

  it('refuses an offset outside the range and does not clamp it', () => {
    const result = syncHereOffset(45, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/30 seconds/);
  });

  it('accepts the ends of the range', () => {
    expect(syncHereOffset(30, 0)).toEqual({ ok: true, offset: 30 });
    expect(syncHereOffset(0, 30)).toEqual({ ok: true, offset: -30 });
  });

  it('refuses a position that is not a number', () => {
    expect(syncHereOffset(Number.NaN, 0).ok).toBe(false);
  });
});

describe('firstNoteSeconds', () => {
  const timeline = (notes: Record<number, number[]>, percussion: number[] = []) => ({
    tracks: Object.keys(notes).map((i) => ({ index: Number(i), isPercussion: percussion.includes(Number(i)) })),
    notesForTrack: (i: number) => (notes[i] ?? []).map((startSeconds) => ({ startSeconds })),
  });

  it('is the earliest first note across the pitched tracks', () => {
    expect(firstNoteSeconds(timeline({ 0: [4, 5], 1: [2.5] }))).toBe(2.5);
  });

  it('ignores drum tracks', () => {
    expect(firstNoteSeconds(timeline({ 0: [4], 1: [0.5] }, [1]))).toBe(4);
  });

  it('is zero when there are no notes', () => {
    expect(firstNoteSeconds(timeline({ 0: [] }))).toBe(0);
  });
});
