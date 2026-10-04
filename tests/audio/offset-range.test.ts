import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  NUDGE_COARSE_SECONDS,
  NUDGE_FINE_SECONDS,
  OFFSET_MAX_SECONDS,
  OFFSET_MIN_SECONDS,
} from '../../src/audio/offset-range';

describe('offset range', () => {
  it('is 30 seconds either way with 10 ms and 100 ms nudges', () => {
    expect(OFFSET_MIN_SECONDS).toBe(-30);
    expect(OFFSET_MAX_SECONDS).toBe(30);
    expect(NUDGE_FINE_SECONDS).toBe(0.01);
    expect(NUDGE_COARSE_SECONDS).toBe(0.1);
  });

  it('clamps at both limits and passes values inside through', () => {
    expect(clampOffset(45)).toBe(30);
    expect(clampOffset(-45)).toBe(-30);
    expect(clampOffset(-1.5)).toBe(-1.5);
    expect(clampOffset(2)).toBe(2);
  });

  it('treats a value that is not a number as zero and infinities as the limits', () => {
    expect(clampOffset(Number.NaN)).toBe(0);
    expect(clampOffset(Number.POSITIVE_INFINITY)).toBe(30);
    expect(clampOffset(Number.NEGATIVE_INFINITY)).toBe(-30);
  });
});
