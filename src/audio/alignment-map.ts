import { clampOffset } from './offset-range';

/**
 * While the recording plays extra material the tab waits; its time is reported this far before the bar
 * line so the bar just finished stays the current one (a bar line counts as the start of the next bar).
 */
export const HOLD_DISPLAY_SECONDS = 0.001;

/** A recorded bar this much longer than the tab's bar counts as extra playing. */
export const EXTRA_PLAYING_SECONDS = 1;

/** Which side of a hold a tab time means: `start` is where the tab rejoins, `end` is where it arrives. */
export type HoldEdge = 'start' | 'end';

/** Extra playing: `length` seconds of recording that go by while the tab stays on the bar line at tab time `at`. */
export interface Hold {
  readonly at: number;
  readonly length: number;
}

/** A played bar of the tab, in tab seconds. */
export interface BarSpan {
  readonly start: number;
  readonly end: number;
}

export interface AlignmentData {
  readonly base: number;
  readonly holds: readonly Hold[];
  /** Present for the anchors form: the recording second at which each played bar starts, and when the tab ends. */
  readonly anchors?: readonly number[];
  readonly endAnchor?: number;
  readonly bars?: readonly BarSpan[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUsable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

interface Anchored {
  readonly bars: readonly BarSpan[];
  readonly anchors: readonly number[];
  readonly endAnchor: number;
}

/**
 * Where the recording sits against the tab, in one of two forms.
 *
 * The first form is a base offset (the recording position of tab time zero) plus ordered holds: away from a
 * hold the recording position is the tab time plus the offset so far, which is a single offset when there are
 * no holds. The second form has one anchor per played bar, the recording second at which that bar starts: the
 * tab runs steadily with the recording inside a bar, never passes the next bar line before the recording
 * reaches the next anchor, and re-syncs to it there. A bar recorded long makes the tab wait on its line (extra
 * playing), and a bar recorded short makes it step forward.
 *
 * Either way the recording leads: tab time is read from the recording position.
 */
export class AlignmentMap {
  private derived: readonly Hold[] | null = null;

  private constructor(
    private readonly offset: number,
    private readonly firstHolds: readonly Hold[],
    private readonly anchored: Anchored | null,
  ) {}

  /** A map with only a base offset. */
  static fromOffset(offset: number): AlignmentMap {
    return AlignmentMap.of(offset, []);
  }

  /**
   * Builds the first form from loose input: holds are sorted, unusable ones dropped, holds on one bar line
   * merged, a hold at tab zero folded into the base offset, and the base offset kept inside the app's offset range.
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
    return new AlignmentMap(clampOffset(offset), sorted, null);
  }

  /**
   * Builds the anchors form: `anchors[k]` is the recording second at which played bar `k` starts and
   * `endAnchor` is where the tab ends. Returns null when they do not fit the bars or are not numbers; a run
   * that decreases is repaired to hold its highest value, since the recording cannot go backwards.
   */
  static fromAnchors(bars: readonly BarSpan[], anchors: readonly number[], endAnchor: number): AlignmentMap | null {
    if (bars.length === 0 || anchors.length !== bars.length || !isUsable(endAnchor)) return null;
    if (!anchors.every(isUsable) || !bars.every((b) => isUsable(b.start) && isUsable(b.end) && b.end >= b.start)) return null;
    let highest = -Infinity;
    const steady = anchors.map((a) => (highest = Math.max(highest, a)));
    const end = Math.max(endAnchor, highest);
    return new AlignmentMap(steady[0] - bars[0].start, [], { bars: bars.map((b) => ({ start: b.start, end: b.end })), anchors: steady, endAnchor: end });
  }

  /** A trusted map from untrusted stored or posted data, or null when it is not a map at all. */
  static normalize(raw: unknown): AlignmentMap | null {
    if (!isRecord(raw) || !isUsable(raw.base)) return null;
    if (Array.isArray(raw.anchors) && Array.isArray(raw.bars) && isUsable(raw.endAnchor)) {
      const bars: BarSpan[] = [];
      for (const b of raw.bars) {
        if (!isRecord(b) || !isUsable(b.start) || !isUsable(b.end)) return AlignmentMap.firstForm(raw);
        bars.push({ start: b.start, end: b.end });
      }
      const anchored = AlignmentMap.fromAnchors(bars, raw.anchors as number[], raw.endAnchor);
      if (anchored) return anchored;
    }
    return AlignmentMap.firstForm(raw);
  }

  private static firstForm(raw: Record<string, unknown>): AlignmentMap {
    const holds: Hold[] = [];
    if (Array.isArray(raw.holds)) {
      for (const h of raw.holds) {
        if (isRecord(h) && isUsable(h.at) && isUsable(h.length)) holds.push({ at: h.at, length: h.length });
      }
    }
    return AlignmentMap.of(raw.base as number, holds);
  }

  get hasAnchors(): boolean {
    return this.anchored !== null;
  }

  /** Where tab time zero sits in the recording. */
  get base(): number {
    return this.offset;
  }

  /** The anchors form's anchors and end anchor, for saving; null in the first form. */
  get anchorData(): { anchors: readonly number[]; endAnchor: number } | null {
    return this.anchored ? { anchors: this.anchored.anchors, endAnchor: this.anchored.endAnchor } : null;
  }

  /**
   * Extra playing. The first form's holds as given; in the anchors form, derived: each bar recorded at least
   * `EXTRA_PLAYING_SECONDS` longer than the tab's bar, as a hold on the line that ends it.
   */
  get holds(): readonly Hold[] {
    if (!this.anchored) return this.firstHolds;
    if (!this.derived) {
      const { bars, anchors, endAnchor } = this.anchored;
      const found: Hold[] = [];
      for (let k = 0; k < bars.length; k++) {
        const recorded = (k + 1 < bars.length ? anchors[k + 1] : endAnchor) - anchors[k];
        const excess = recorded - (bars[k].end - bars[k].start);
        if (excess >= EXTRA_PLAYING_SECONDS) found.push({ at: bars[k].end, length: excess });
      }
      this.derived = found;
    }
    return this.derived;
  }

  toData(): AlignmentData {
    const holds = this.holds.map((h) => ({ at: h.at, length: h.length }));
    if (!this.anchored) return { base: this.offset, holds };
    return {
      base: this.offset,
      holds,
      anchors: [...this.anchored.anchors],
      endAnchor: this.anchored.endAnchor,
      bars: this.anchored.bars.map((b) => ({ start: b.start, end: b.end })),
    };
  }

  /** Seconds of recording that play while the tab waits, over every hold. */
  get totalHold(): number {
    return this.holds.reduce((sum, h) => sum + h.length, 0);
  }

  /** How long the recording runs while the tab plays its `tabSeconds`: the length of an export. */
  outputLength(tabSeconds: number): number {
    if (this.anchored) return this.anchored.endAnchor - this.anchored.anchors[0];
    return tabSeconds + this.totalHold;
  }

  /** The tab time at a recording position. While the tab waits it is just before the bar line it waits on. */
  toTab(recording: number): number {
    if (this.anchored) return this.anchoredToTab(this.anchored, recording);
    let passed = 0;
    for (const hold of this.firstHolds) {
      const begins = hold.at + this.offset + passed;
      if (recording < begins) break;
      if (recording < begins + hold.length) return hold.at - HOLD_DISPLAY_SECONDS;
      passed += hold.length;
    }
    return recording - this.offset - passed;
  }

  /** The recording position of a tab time; at a bar line `edge` picks the arrival or the rejoin. */
  toRec(tab: number, edge: HoldEdge): number {
    if (this.anchored) return this.anchoredToRec(this.anchored, tab, edge);
    let passed = 0;
    for (const hold of this.firstHolds) {
      if (hold.at < tab || (edge === 'start' && hold.at === tab)) passed += hold.length;
      else break;
    }
    return tab + this.offset + passed;
  }

  /** True while the recording position is inside a stretch where tab time stands still. */
  inHold(recording: number): boolean {
    if (this.anchored) {
      const { bars, anchors, endAnchor } = this.anchored;
      if (recording < anchors[0] || recording >= endAnchor) return false;
      const k = lastAtOrBefore(anchors, recording);
      const next = k + 1 < bars.length ? anchors[k + 1] : endAnchor;
      return recording >= anchors[k] + (bars[k].end - bars[k].start) && recording < next;
    }
    let passed = 0;
    for (const hold of this.firstHolds) {
      const begins = hold.at + this.offset + passed;
      if (recording < begins) return false;
      if (recording < begins + hold.length) return true;
      passed += hold.length;
    }
    return false;
  }

  withBase(offset: number): AlignmentMap {
    if (!this.anchored) return AlignmentMap.of(offset, this.firstHolds);
    return this.shifted(0, offset - this.offset);
  }

  /** Adds extra playing; in the first form a hold on a bar line already there grows, in the anchors form it goes into the bar that ends at `at`. */
  withHold(hold: Hold): AlignmentMap {
    if (!this.anchored) return AlignmentMap.of(this.offset, [...this.firstHolds, hold]);
    if (!isUsable(hold.length) || hold.length <= 0) return this;
    const k = this.anchored.bars.findIndex((b) => Math.abs(b.end - hold.at) < 0.001);
    return k < 0 ? this : this.shifted(k + 1, hold.length);
  }

  withoutHold(index: number): AlignmentMap {
    if (!this.anchored) {
      return AlignmentMap.of(
        this.offset,
        this.firstHolds.filter((_, i) => i !== index),
      );
    }
    const k = this.barOfHold(index);
    return k < 0 ? this : this.shifted(k + 1, -this.holds[index].length);
  }

  withHoldLength(index: number, length: number): AlignmentMap {
    if (!this.anchored) {
      return AlignmentMap.of(
        this.offset,
        this.firstHolds.map((h, i) => (i === index ? { at: h.at, length } : h)),
      );
    }
    const k = this.barOfHold(index);
    return k < 0 ? this : this.shifted(k + 1, length - this.holds[index].length);
  }

  /** The bar a derived hold belongs to: the one that ends on its line. */
  private barOfHold(index: number): number {
    const hold = this.holds[index];
    if (!this.anchored || !hold) return -1;
    return this.anchored.bars.findIndex((b) => Math.abs(b.end - hold.at) < 0.001);
  }

  /** The anchors form with every anchor from bar `from` on, and the end anchor, moved by `delta`. */
  private shifted(from: number, delta: number): AlignmentMap {
    const a = this.anchored!;
    const anchors = a.anchors.map((x, i) => (i >= from ? x + delta : x));
    return AlignmentMap.fromAnchors(a.bars, anchors, a.endAnchor + delta) ?? this;
  }

  private anchoredToTab(a: Anchored, recording: number): number {
    const { bars, anchors, endAnchor } = a;
    if (recording < anchors[0]) return bars[0].start + (recording - anchors[0]);
    if (recording >= endAnchor) return bars[bars.length - 1].end + (recording - endAnchor);
    const k = lastAtOrBefore(anchors, recording);
    const nextLine = k + 1 < bars.length ? bars[k + 1].start : bars[k].end;
    return Math.min(bars[k].start + (recording - anchors[k]), nextLine - HOLD_DISPLAY_SECONDS);
  }

  private anchoredToRec(a: Anchored, tab: number, edge: HoldEdge): number {
    const { bars, anchors, endAnchor } = a;
    if (tab < bars[0].start) return anchors[0] + (tab - bars[0].start);
    const last = bars.length - 1;
    if (tab >= bars[last].end) return endAnchor + (tab - bars[last].end);
    let k = lastStartingAtOrBefore(bars, tab);
    if (edge === 'end' && k > 0 && tab === bars[k].start) {
      // arriving at the line from the bar before: the tab gets there when that bar's steady run ends, or at this anchor if that comes first
      return Math.min(anchors[k - 1] + (bars[k - 1].end - bars[k - 1].start), anchors[k]);
    }
    if (k < 0) k = 0;
    const next = k + 1 < bars.length ? anchors[k + 1] : endAnchor;
    // inside a skipped or shortened bar the recording does not get further than its next anchor
    return Math.min(anchors[k] + (tab - bars[k].start), next);
  }
}

/** The last index whose value is at or before `x` in an ascending list; -1 when none is. */
function lastAtOrBefore(values: readonly number[], x: number): number {
  let lo = 0;
  let hi = values.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] <= x) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function lastStartingAtOrBefore(bars: readonly BarSpan[], tab: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].start <= tab) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
