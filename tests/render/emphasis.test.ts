import { describe, expect, it } from 'vitest';
import { APPROACH_SECONDS, emphasisAt, MIN_HOLD_SECONDS } from '../../src/render/emphasis';

describe('emphasisAt', () => {
  it('leaves a note far from its start at normal size', () => {
    expect(emphasisAt(10, 11, 10 - APPROACH_SECONDS - 0.1)).toEqual({ scale: 1, sounding: false, pop: 0 });
  });

  it('swells gradually over the approach window', () => {
    const early = emphasisAt(10, 11, 10 - APPROACH_SECONDS * 0.9).scale;
    const late = emphasisAt(10, 11, 10 - APPROACH_SECONDS * 0.1).scale;
    expect(early).toBeGreaterThan(1);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThan(emphasisAt(10, 11, 10).scale);
  });

  it('is biggest at the instant the note starts and settles while it is held', () => {
    const atStart = emphasisAt(10, 12, 10);
    const held = emphasisAt(10, 12, 11.5);
    expect(atStart.sounding).toBe(true);
    expect(atStart.pop).toBe(1);
    expect(atStart.scale).toBeGreaterThan(held.scale);
    expect(held.scale).toBeGreaterThan(1);
    expect(held.sounding).toBe(true);
  });

  it('returns to normal size once the note ends', () => {
    expect(emphasisAt(10, 11, 11.01)).toEqual({ scale: 1, sounding: false, pop: 0 });
  });

  it('keeps a very short note enlarged for the minimum hold', () => {
    expect(emphasisAt(10, 10.05, 10 + MIN_HOLD_SECONDS * 0.9).sounding).toBe(true);
    expect(emphasisAt(10, 10.05, 10 + MIN_HOLD_SECONDS + 0.01).sounding).toBe(false);
  });
});
