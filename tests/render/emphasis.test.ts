import { describe, expect, it } from 'vitest';
import { APPROACH_SECONDS, emphasisAt } from '../../src/render/emphasis';

describe('emphasisAt', () => {
  it('leaves a note far from its start at normal size', () => {
    expect(emphasisAt(10, 11, 10 - APPROACH_SECONDS - 0.1)).toEqual({ scale: 1, pop: 0 });
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
    expect(atStart.pop).toBe(1);
    expect(atStart.scale).toBeGreaterThan(held.scale);
    expect(held.scale).toBeGreaterThan(1);
  });

  it('returns to normal size once the note ends', () => {
    expect(emphasisAt(10, 11, 11.01)).toEqual({ scale: 1, pop: 0 });
  });

  it('covers AE1: a 50 ms note is not enlarged or sounding 100 ms after it starts (no minimum hold)', () => {
    expect(emphasisAt(10, 10.05, 10.02).scale).toBeGreaterThan(1);
    expect(emphasisAt(10, 10.05, 10.1)).toEqual({ scale: 1, pop: 0 });
  });

  it('is sounding at the exact start and not at the exact end', () => {
    expect(emphasisAt(10, 11, 10).scale).toBeGreaterThan(1);
    expect(emphasisAt(10, 11, 11)).toEqual({ scale: 1, pop: 0 });
  });

  it('never enlarges a note of no length once it has started', () => {
    expect(emphasisAt(10, 10, 10)).toEqual({ scale: 1, pop: 0 });
  });
});
