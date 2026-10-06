import type { BarSpan } from './alignment-map';

const FNV_OFFSET = 0x811c9dc5;

/** Folds a time, to the millisecond, into a 32-bit FNV-1a hash. */
function mixSeconds(hash: number, seconds: number): number {
  const v = Math.round(seconds * 1000);
  for (let shift = 0; shift < 32; shift += 8) {
    hash ^= (v >>> shift) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

const hex = (hash: number) => hash.toString(16).padStart(8, '0');

/**
 * A short name for the tab's played bars: their count and a hash of every bar's start and end to the millisecond. A saved
 * timeline is only reused against the tab it was placed on, so an edit that moves timing between bars without changing the
 * total length still reads as another tab. The track or tuning a player picks does not change it.
 */
export function tabFingerprint(bars: readonly BarSpan[]): string {
  let hash = FNV_OFFSET;
  for (const bar of bars) hash = mixSeconds(mixSeconds(hash, bar.start), bar.end);
  return `${bars.length}:${hex(hash)}`;
}

/** A short name for one played bar of the tab, from its start and end to the millisecond; the same bar always gets the same name. */
export function barSignature(bar: BarSpan): string {
  return hex(mixSeconds(mixSeconds(FNV_OFFSET, bar.start), bar.end));
}
