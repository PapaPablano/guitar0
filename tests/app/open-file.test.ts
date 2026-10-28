import { describe, expect, it } from 'vitest';
import { firstPlayableTrack } from '../../src/app/open-file';
import type { NoteEvent, Timeline, TrackInfo } from '../../src/model/score';

const track = (index: number, program: number, isPercussion = false): TrackInfo => ({
  index,
  name: `track ${index}`,
  stringCount: 6,
  tuning: [],
  hasTabData: true,
  isPercussion,
  program,
});

/** A timeline whose tracks have notes starting at the given seconds (none for an empty list). */
function timelineOf(tracks: readonly TrackInfo[], starts: Readonly<Record<number, readonly number[]>>): Timeline {
  return {
    tracks,
    notesForTrack: (i: number) => (starts[i] ?? []).map((startSeconds) => ({ startSeconds }) as NoteEvent),
  } as unknown as Timeline;
}

describe('firstPlayableTrack', () => {
  it('opens on the first guitar that plays in the opening, not on a vocal line that is silent there', () => {
    const tl = timelineOf([track(0, 66), track(1, 30), track(2, 27), track(3, 33)], { 0: [40], 1: [30], 2: [0, 1], 3: [0] });
    expect(firstPlayableTrack(tl)).toBe(2);
  });

  it('keeps the first track when it is a guitar that plays in the opening', () => {
    const tl = timelineOf([track(0, 29), track(1, 27)], { 0: [2], 1: [0] });
    expect(firstPlayableTrack(tl)).toBe(0);
  });

  it('takes the first guitar with notes when none plays in the opening', () => {
    const tl = timelineOf([track(0, 33), track(1, 30), track(2, 27)], { 0: [0], 1: [60], 2: [90] });
    expect(firstPlayableTrack(tl)).toBe(1);
  });

  it('takes the first pitched track with notes when the file has no guitar', () => {
    const tl = timelineOf([track(0, 0, true), track(1, 33), track(2, 0)], { 0: [0], 1: [0], 2: [0] });
    expect(firstPlayableTrack(tl)).toBe(1);
  });

  it('falls back to the first pitched track when no track has notes', () => {
    const tl = timelineOf([track(0, 0, true), track(1, 30)], {});
    expect(firstPlayableTrack(tl)).toBe(1);
  });
});
