import { describe, expect, it } from 'vitest';
import { copyStateText, holdText } from '../../src/app/exactness-text';

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
