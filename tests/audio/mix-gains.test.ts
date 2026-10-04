import { describe, expect, it } from 'vitest';
import { initialMix, MAX_STEM_VOLUME, stemGains, type MixState } from '../../src/audio/mix-gains';

function mix(patch: Partial<Record<keyof MixState, Partial<MixState['vocals']>>>): MixState {
  const base = initialMix();
  for (const [name, change] of Object.entries(patch)) Object.assign(base[name as keyof MixState], change);
  return base;
}

describe('stemGains', () => {
  it('starts with every stem at full volume', () => {
    expect(Object.values(stemGains(initialMix()))).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('covers AE5/R9: muting the guitar leaves the other five at their volumes', () => {
    const g = stemGains(mix({ guitar: { muted: true }, drums: { volume: 0.5 } }));
    expect(g.guitar).toBe(0);
    expect(g.drums).toBe(0.5);
    expect(g.vocals).toBe(1);
    expect(g.bass).toBe(1);
    expect(g.piano).toBe(1);
    expect(g.other).toBe(1);
  });

  it('soloing the guitar silences every other stem and keeps its own volume', () => {
    const g = stemGains(mix({ guitar: { solo: true, volume: 0.8 } }));
    expect(g.guitar).toBe(0.8);
    expect(g.vocals + g.drums + g.bass + g.piano + g.other).toBe(0);
  });

  it('plays two soloed stems together, and clearing one solo restores the single solo', () => {
    const both = stemGains(mix({ guitar: { solo: true }, bass: { solo: true } }));
    expect([both.guitar, both.bass, both.drums]).toEqual([1, 1, 0]);
    const one = stemGains(mix({ guitar: { solo: true }, bass: { solo: false } }));
    expect([one.guitar, one.bass]).toEqual([1, 0]);
  });

  it('keeps a stem silent when it is both muted and soloed', () => {
    const g = stemGains(mix({ guitar: { solo: true, muted: true }, bass: { solo: true } }));
    expect(g.guitar).toBe(0);
    expect(g.bass).toBe(1);
  });

  it('lets a stem be boosted to double its level, and no further', () => {
    const g = stemGains(mix({ guitar: { volume: 1.5 }, drums: { volume: 3 }, bass: { volume: -1 } }));
    expect(g.guitar).toBe(1.5);
    expect(g.drums).toBe(MAX_STEM_VOLUME);
    expect(MAX_STEM_VOLUME).toBe(2);
    expect(g.bass).toBe(0);
  });
});
