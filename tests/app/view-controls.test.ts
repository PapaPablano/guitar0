import { describe, expect, it } from 'vitest';
import { initialViewState } from '../../src/app/ViewControls';
import { clampLookahead } from '../../src/render/fretboard-steps';

describe('initialViewState', () => {
  it('starts on the highway over the tab strip with a look-ahead of 4 and fret labels', () => {
    expect(initialViewState()).toEqual({ layout: { top: 'highway', bottom: 'tab' }, lookahead: 4, labelMode: 'fret' });
  });

  it('returns a fresh object each time, so a reset never shares state', () => {
    expect(initialViewState()).not.toBe(initialViewState());
  });
});

describe('clampLookahead as the controls use it', () => {
  it('keeps the field between 1 and 8 and falls back to 4', () => {
    expect(clampLookahead(0)).toBe(1);
    expect(clampLookahead(12)).toBe(8);
    expect(clampLookahead(3.4)).toBe(3);
    expect(clampLookahead(undefined)).toBe(4);
  });
});
