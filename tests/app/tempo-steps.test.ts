import { describe, expect, it } from 'vitest';
import { stepTempo, TEMPO_MAX, TEMPO_MIN, TEMPO_STEP } from '../../src/app/tempo-steps';

describe('tempo steps', () => {
  it('offers 25, 50, 75, 100 and 125 percent', () => {
    const offered: number[] = [];
    for (let p = TEMPO_MIN; p <= TEMPO_MAX; p += TEMPO_STEP) offered.push(p);
    expect(offered).toEqual([25, 50, 75, 100, 125]);
  });

  it('steps down from 100 to 25 and stops', () => {
    let p = 100;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      p = stepTempo(p, -1);
      seen.push(p);
    }
    expect(seen).toEqual([75, 50, 25, 25, 25]);
  });

  it('steps up from 100 to 125 and stops', () => {
    expect(stepTempo(100, 1)).toBe(125);
    expect(stepTempo(125, 1)).toBe(125);
  });
});
