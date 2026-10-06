import { describe, expect, it } from 'vitest';
import { tabFingerprint } from '../../src/audio/tab-fingerprint';

const bars = Array.from({ length: 8 }, (_, i) => ({ start: i * 2, end: i * 2 + 2 }));

describe('tabFingerprint', () => {
  it('is the same for the same bars every time and starts with the bar count', () => {
    expect(tabFingerprint(bars)).toBe(tabFingerprint(bars.map((b) => ({ ...b }))));
    expect(tabFingerprint(bars).startsWith('8:')).toBe(true);
  });

  it('changes when timing moves by a millisecond, even with the same total length, and when the bar count changes', () => {
    const moved = bars.map((b, i) => (i === 3 ? { start: b.start, end: b.end + 0.001 } : i === 4 ? { start: b.start + 0.001, end: b.end } : b));
    expect(tabFingerprint(moved)).not.toBe(tabFingerprint(bars));
    expect(tabFingerprint(bars.slice(0, 7))).not.toBe(tabFingerprint(bars));
  });
});
