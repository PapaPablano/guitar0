import { describe, expect, it } from 'vitest';
import { initialMix, stemGains } from '../../src/audio/mix-gains';
import { FADE_OUT_STEPS, passMix, type PassSchedule } from '../../src/audio/pass-schedule';

const fade: PassSchedule = { kind: 'fade-out', steps: FADE_OUT_STEPS };
const alternate: PassSchedule = { kind: 'listen-then-play' };

describe('passMix', () => {
  it('steps the guitar 100, 60, 25, 0 on passes 1 to 4 and holds 0', () => {
    const base = initialMix();
    const amounts = [1, 2, 3, 4, 5, 9].map((p) => passMix(base, fade, p).guitar.volume);
    expect(amounts).toEqual([1, 0.6, 0.25, 0, 0, 0]);
  });

  it('applies the step on top of the base guitar volume and leaves other stems alone', () => {
    const base = initialMix();
    base.guitar.volume = 0.8;
    base.drums.volume = 0.5;
    const mix = passMix(base, fade, 2);
    expect(mix.guitar.volume).toBeCloseTo(0.48, 9);
    expect(mix.drums.volume).toBe(0.5);
  });

  it('a listen pass is audible even when the base guitar amount is none', () => {
    const base = initialMix();
    base.guitar.volume = 0;
    const listen = passMix(base, alternate, 1);
    expect(stemGains(listen).guitar).toBe(1);
    expect(stemGains(listen).drums).toBe(0);
    // The play pass is unaffected, and the base is not changed.
    expect(stemGains(passMix(base, alternate, 2)).guitar).toBe(0);
    expect(base.guitar.volume).toBe(0);
  });

  it('keeps a muted base guitar muted', () => {
    const base = initialMix();
    base.guitar.muted = true;
    expect(passMix(base, fade, 1).guitar.muted).toBe(true);
  });

  it('alternates a solo guitar pass on odd passes with a muted guitar on even passes', () => {
    const base = initialMix();
    const odd = stemGains(passMix(base, alternate, 1));
    expect(odd.guitar).toBe(1);
    expect(odd.drums).toBe(0);
    expect(odd.bass).toBe(0);
    const even = stemGains(passMix(base, alternate, 2));
    expect(even.guitar).toBe(0);
    expect(even.drums).toBe(1);
    expect(stemGains(passMix(base, alternate, 3)).guitar).toBe(1);
    expect(stemGains(passMix(base, alternate, 4)).guitar).toBe(0);
  });

  it('returns the base mix for an off schedule and never mutates the base', () => {
    const base = initialMix();
    const snapshot = JSON.stringify(base);
    expect(passMix(base, { kind: 'off' }, 3)).toEqual(base);
    passMix(base, fade, 4);
    passMix(base, alternate, 2);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
