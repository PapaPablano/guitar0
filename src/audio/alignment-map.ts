import { clampOffset } from './offset-range';

/**
 * While the recording plays extra material the tab waits; its time is reported this far before the bar
 * line so the bar just finished stays the current one (a bar line counts as the start of the next bar).
 */
export const HOLD_DISPLAY_SECONDS = 0.001;

/** Which side of a hold a tab time means: `start` is where the tab rejoins, `end` is where it arrives. */
export type HoldEdge = 'start' | 'end';

/** Extra playing: `length` seconds of recording that go by while the tab stays on the bar line at tab time `at`. */
export interface Hold {
  readonly at: number;
  readonly length: number;
}

export interface AlignmentData {
  readonly base: number;
  readonly holds: readonly Hold[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUsable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Where the recording sits against the tab: a base offset (the recording position of tab time zero) plus
 * ordered holds. Away from a hold the recording position is the tab time plus the offset so far, which is
 * today's single offset; a map without holds is exactly that. The recording leads: tab time is read from the
 * recording position, and it stands still while a hold plays.
 */
export class AlignmentMap {
  private constructor(
    readonly base: number,
    readonly holds: readonly Hold[],
  ) {}

  /** A map with only a base offset. */
  static fromOffset(offset: number): AlignmentMap {
    return AlignmentMap.of(offset, []);
  }

  /**
   * Builds a map from loose input: holds are sorted, unusable ones dropped, holds on one bar line merged, a
   * hold at tab zero folded into the base offset, and the base offset kept inside the app's offset range.
   */
  static of(base: number, holds: readonly Hold[]): AlignmentMap {
    let offset = isUsable(base) ? base : 0;
    const byBar = new Map<number, number>();
    for (const hold of holds) {
      if (!isUsable(hold.at) || !isUsable(hold.length) || hold.length <= 0) continue;
      if (hold.at <= 0) {
        offset += hold.length;
        continue;
      }
      byBar.set(hold.at, (byBar.get(hold.at) ?? 0) + hold.length);
    }
    const sorted = [...byBar].sort((a, b) => a[0] - b[0]).map(([at, length]) => ({ at, length }));
    return new AlignmentMap(clampOffset(offset), sorted);
  }

  /** A trusted map from untrusted stored or posted data, or null when it is not a map at all. */
  static normalize(raw: unknown): AlignmentMap | null {
    if (!isRecord(raw) || !isUsable(raw.base)) return null;
    const holds: Hold[] = [];
    if (Array.isArray(raw.holds)) {
      for (const h of raw.holds) {
        if (isRecord(h) && isUsable(h.at) && isUsable(h.length)) holds.push({ at: h.at, length: h.length });
      }
    }
    return AlignmentMap.of(raw.base, holds);
  }

  toData(): AlignmentData {
    return { base: this.base, holds: this.holds.map((h) => ({ at: h.at, length: h.length })) };
  }

  /** Seconds of recording that play while the tab waits, over every hold. */
  get totalHold(): number {
    return this.holds.reduce((sum, h) => sum + h.length, 0);
  }

  /** The tab time at a recording position. Inside a hold it is just before that hold's bar line. */
  toTab(recording: number): number {
    let passed = 0;
    for (const hold of this.holds) {
      const begins = hold.at + this.base + passed;
      if (recording < begins) break;
      if (recording < begins + hold.length) return hold.at - HOLD_DISPLAY_SECONDS;
      passed += hold.length;
    }
    return recording - this.base - passed;
  }

  /** The recording position of a tab time; at a hold's own bar line `edge` picks the arrival or the rejoin. */
  toRec(tab: number, edge: HoldEdge): number {
    let passed = 0;
    for (const hold of this.holds) {
      if (hold.at < tab || (edge === 'start' && hold.at === tab)) passed += hold.length;
      else break;
    }
    return tab + this.base + passed;
  }

  /** True while the recording position is inside a stretch of extra playing, where tab time stands still. */
  inHold(recording: number): boolean {
    let passed = 0;
    for (const hold of this.holds) {
      const begins = hold.at + this.base + passed;
      if (recording < begins) return false;
      if (recording < begins + hold.length) return true;
      passed += hold.length;
    }
    return false;
  }

  withBase(offset: number): AlignmentMap {
    return AlignmentMap.of(offset, this.holds);
  }

  /** Adds a hold; a hold already on that bar line grows by this one's length. */
  withHold(hold: Hold): AlignmentMap {
    return AlignmentMap.of(this.base, [...this.holds, hold]);
  }

  withoutHold(index: number): AlignmentMap {
    return AlignmentMap.of(
      this.base,
      this.holds.filter((_, i) => i !== index),
    );
  }

  withHoldLength(index: number, length: number): AlignmentMap {
    return AlignmentMap.of(
      this.base,
      this.holds.map((h, i) => (i === index ? { at: h.at, length } : h)),
    );
  }
}
