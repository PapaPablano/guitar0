import { describe, expect, it } from 'vitest';
import { clampLookahead, initialViewState } from '../../src/app/ViewControls';

describe('initialViewState', () => {
  it('starts on the tab strip with a look-ahead of 4', () => {
    expect(initialViewState()).toEqual({ bottomView: 'tab', lookahead: 4 });
  });

  it('returns a fresh object each time, so a reset never shares state', () => {
    expect(initialViewState()).not.toBe(initialViewState());
  });
});

describe('clampLookahead from the controls module', () => {
  it('keeps the field between 1 and 8 and falls back to 4', () => {
    expect(clampLookahead(0)).toBe(1);
    expect(clampLookahead(12)).toBe(8);
    expect(clampLookahead(3.4)).toBe(3);
    expect(clampLookahead(undefined)).toBe(4);
  });
});
