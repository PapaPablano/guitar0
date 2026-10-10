import { describe, expect, it } from 'vitest';
import { canPlayAlong, silentTrackFor } from '../../src/app/play-along';
import type { TrackInfo } from '../../src/model/score';

function track(index: number, isPercussion = false): TrackInfo {
  return { index, name: `T${index}`, stringCount: 6, tuning: [], hasTabData: true, isPercussion, program: 30 };
}

const BAND = [track(0), track(1), track(2, true)];

describe('silentTrackFor', () => {
  it('silences nothing while the switch is off', () => {
    expect(silentTrackFor(false, BAND, 0)).toBeNull();
  });

  it('silences the viewed track while the switch is on', () => {
    expect(silentTrackFor(true, BAND, 1)).toBe(1);
  });

  it('follows the viewed track when it changes', () => {
    expect(silentTrackFor(true, BAND, 0)).toBe(0);
    expect(silentTrackFor(true, BAND, 1)).toBe(1);
  });

  it('silences nothing on a percussion track', () => {
    expect(silentTrackFor(true, BAND, 2)).toBeNull();
  });

  it('silences nothing when the song has no other track', () => {
    expect(silentTrackFor(true, [track(0)], 0)).toBeNull();
  });

  it('silences nothing when the viewed track is not in the song', () => {
    expect(silentTrackFor(true, BAND, 9)).toBeNull();
  });
});

describe('canPlayAlong', () => {
  it('offers the switch only for a pitched track with company', () => {
    expect(canPlayAlong(BAND, 0)).toBe(true);
    expect(canPlayAlong(BAND, 2)).toBe(false);
    expect(canPlayAlong([track(0)], 0)).toBe(false);
  });
});
