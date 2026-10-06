import { describe, expect, it } from 'vitest';
import { copyStateText, exactLine, holdText, stripSegments } from '../../src/app/exactness-text';
import type { ChunkState } from '../../src/audio/recording-pcm';

describe('copyStateText', () => {
  it('says nothing once the copy is in use for all or part of the recording, or before anything starts', () => {
    expect(copyStateText('exact')).toBe('');
    expect(copyStateText('partial')).toBe('');
    expect(copyStateText(null)).toBe('');
  });

  it('tells the player a jump to a part that is not ready waits for it, without calling it inexact', () => {
    const text = copyStateText('preparing');
    expect(text).toMatch(/waits/);
    expect(text).not.toMatch(/off/);
  });

  it('covers AE5: keeps the approximate warning for a recording that cannot get an exact copy at all', () => {
    for (const state of ['failed', 'too-long'] as const) expect(copyStateText(state)).toMatch(/up to about a second off/);
  });

  it('the old warning appears nowhere else', () => {
    for (const state of ['preparing', 'partial', 'exact', null] as const) expect(copyStateText(state)).not.toMatch(/second off/);
    for (const phase of ['waiting', 'paused', 'counting', 'failed'] as const) expect(holdText({ phase, tab: 1 })).not.toMatch(/second off/);
    expect(exactLine(['exact', 'not-yet'], 10, 20)).not.toMatch(/second off/);
  });
});

describe('holdText', () => {
  it('says what a held jump is doing in each phase', () => {
    expect(holdText({ phase: 'waiting', tab: 4 })).toMatch(/lands as soon as it is ready/);
    expect(holdText({ phase: 'paused', tab: 4 })).toMatch(/Paused.*count-in/);
    expect(holdText({ phase: 'counting', tab: 4 })).toMatch(/Counting in/);
    expect(holdText({ phase: 'failed', tab: 4 })).toMatch(/could not be made exact/);
  });

  it('says nothing when no jump is held', () => {
    expect(holdText(null)).toBe('');
  });
});

const E: ChunkState = 'exact';
const G: ChunkState = 'getting';
const N: ChunkState = 'not-yet';

describe('stripSegments', () => {
  it('merges runs of the same state and gives each as a share of the recording\'s length', () => {
    const segments = stripSegments([E, E, G, N, N, N], 10, 60);
    expect(segments).toEqual([
      { from: 0, to: 20 / 60, state: 'exact' },
      { from: 20 / 60, to: 30 / 60, state: 'getting' },
      { from: 30 / 60, to: 1, state: 'not-yet' },
    ]);
  });

  it('ends the last chunk where the recording ends, which may be before the chunk does', () => {
    const segments = stripSegments([E, E, N], 10, 25);
    expect(segments[segments.length - 1]).toEqual({ from: 20 / 25, to: 1, state: 'not-yet' });
  });

  it('shows a part that failed as not yet, and gives nothing for an empty recording', () => {
    expect(stripSegments(['failed', N], 10, 20)).toEqual([{ from: 0, to: 1, state: 'not-yet' }]);
    expect(stripSegments([E], 10, 0)).toEqual([]);
  });
});

describe('exactLine', () => {
  it('covers AE4: names the exact part, and says a jump elsewhere waits', () => {
    const states: ChunkState[] = [E, E, E, G, N, N];
    const line = exactLine(states, 10, 60);
    expect(line).toMatch(/exact in 0:00–0:30/);
    expect(line).toMatch(/waits a moment/);
  });

  it('lists the separate stretches that are exact, and keeps the line short', () => {
    expect(exactLine([E, N, E, N, N, E], 10, 60)).toMatch(/0:00–0:10, 0:20–0:30, 0:50–1:00/);
    expect(exactLine([E, N, E, N, E, N, E, N], 10, 80)).toMatch(/, more\./);
  });

  it('says the first part is on its way when none is exact yet', () => {
    expect(exactLine([G, N, N], 10, 30)).toMatch(/first part/);
  });

  it('is empty when all of the recording is exact, and when there is nothing to describe', () => {
    expect(exactLine([E, E, E], 10, 30)).toBe('');
    expect(exactLine([], 10, 30)).toBe('');
  });
});
