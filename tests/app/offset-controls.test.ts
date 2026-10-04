import { describe, expect, it } from 'vitest';
import { nudgeOffset, offsetControlsVisible, offsetDirectionLabel } from '../../src/app/offset-controls';
import { NUDGE_COARSE_SECONDS, NUDGE_FINE_SECONDS, OFFSET_MAX_SECONDS, OFFSET_MIN_SECONDS } from '../../src/audio/offset-range';

describe('nudgeOffset', () => {
  it('moves 10 ms for a fine nudge and 100 ms for a coarse one, either way', () => {
    expect(nudgeOffset(0, 'fine', 1)).toBe(0.01);
    expect(nudgeOffset(0, 'fine', -1)).toBe(-0.01);
    expect(nudgeOffset(1, 'coarse', 1)).toBe(1.1);
    expect(nudgeOffset(1, 'coarse', -1)).toBe(0.9);
    expect(NUDGE_FINE_SECONDS).toBe(0.01);
    expect(NUDGE_COARSE_SECONDS).toBe(0.1);
  });

  it('crosses zero in both directions', () => {
    expect(nudgeOffset(0.05, 'coarse', -1)).toBe(-0.05);
    expect(nudgeOffset(-0.05, 'coarse', 1)).toBe(0.05);
  });

  it('stays at the range limits', () => {
    expect(nudgeOffset(OFFSET_MAX_SECONDS, 'coarse', 1)).toBe(OFFSET_MAX_SECONDS);
    expect(nudgeOffset(OFFSET_MIN_SECONDS, 'fine', -1)).toBe(OFFSET_MIN_SECONDS);
    expect(nudgeOffset(OFFSET_MAX_SECONDS - 0.04, 'coarse', 1)).toBe(OFFSET_MAX_SECONDS);
  });

  it('rounds floating-point drift to the 10 ms step after many nudges', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = nudgeOffset(v, 'fine', 1);
    expect(v).toBe(1);
    for (let i = 0; i < 30; i++) v = nudgeOffset(v, 'coarse', -1);
    expect(v).toBe(-2);
  });
});

describe('offsetDirectionLabel', () => {
  it('says the recording starts later for a negative offset', () => {
    expect(offsetDirectionLabel(-0.5)).toBe('recording starts later');
  });
  it('says the recording starts earlier for a positive offset', () => {
    expect(offsetDirectionLabel(0.5)).toBe('recording starts earlier');
  });
  it('states zero distinctly', () => {
    expect(offsetDirectionLabel(0)).toBe('in sync with the tab');
    expect(offsetDirectionLabel(0.004)).toBe('in sync with the tab');
  });
});

describe('offsetControlsVisible', () => {
  it('covers AE10: shown whenever a recording is loaded, regardless of bridge or stems', () => {
    expect(offsetControlsVisible({ hasRecording: true })).toBe(true);
    expect(offsetControlsVisible({ hasRecording: false })).toBe(false);
  });
});
