import type { BarSpan } from './alignment-map';

/**
 * A short name for the tab's played bars: their count and a hash of every bar's start and end to the millisecond. A saved
 * timeline is only reused against the tab it was placed on, so an edit that moves timing between bars without changing the
 * total length still reads as another tab. The track or tuning a player picks does not change it.
 */
export function tabFingerprint(bars: readonly BarSpan[]): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    const v = Math.round(value * 1000);
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (v >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  };
  for (const bar of bars) {
    mix(bar.start);
    mix(bar.end);
  }
  return `${bars.length}:${hash.toString(16).padStart(8, '0')}`;
}
