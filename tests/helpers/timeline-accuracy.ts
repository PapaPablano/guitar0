/**
 * Accuracy measurement for the bar-line timeline: generated songs whose true bar lines are known by construction, and
 * the numbers that say how close a detected timeline lands. The tolerance tests in `tests/alignment/accuracy.test.ts`
 * and the whole-song tests read these.
 */
import type { BarSpan } from '../../src/audio/alignment-map';
import {
  bandPerformance,
  seeded,
  songNotes,
  type BarShape,
  type Performance,
  type SongNote,
} from './synthetic-audio';

/** A tab as the generated songs see it: the bars it plays, and the notes written into them. */
export interface TabFixture {
  readonly bars: BarShape[];
  readonly notes: SongNote[];
  /** Length of the tab in seconds. */
  readonly seconds: number;
}

const tabEnd = (bars: readonly BarShape[]): number => bars[bars.length - 1].end;

/** Bars of the given lengths, back to back from zero. A tempo step or a change of meter is a change of length. */
export function barsOfLengths(lengths: readonly number[]): BarShape[] {
  let at = 0;
  return lengths.map((length) => {
    const bar = { start: at, end: at + length };
    at += length;
    return bar;
  });
}

/** Every bar its own chord plus a melody note, so every bar carries an onset at its line. */
export function busyTab(lengths: readonly number[], seed = 11): TabFixture {
  const bars = barsOfLengths(lengths);
  const notes: SongNote[] = [];
  const base = songNotes(bars.length, 1, seed);
  bars.forEach((bar, k) => {
    const length = bar.end - bar.start;
    for (const n of base) {
      if (n.start < k || n.start >= k + 1) continue;
      notes.push({ start: bar.start + (n.start - k) * length, duration: n.duration * length, midi: n.midi });
    }
  });
  return { bars, notes, seconds: tabEnd(bars) };
}

/**
 * Chords held for `run` bars at a time: the only onset is where a run starts, so the bars inside a run have nothing to
 * pin them but the steadiness of the stretch (sustained chords, as in a distorted guitar part).
 */
export function sustainedTab(lengths: readonly number[], run = 4, seed = 23): TabFixture {
  const bars = barsOfLengths(lengths);
  const random = seeded(seed);
  const notes: SongNote[] = [];
  for (let first = 0; first < bars.length; first += run) {
    const last = Math.min(bars.length, first + run) - 1;
    const root = 40 + Math.floor(random() * 12);
    const third = root + (random() < 0.5 ? 3 : 4);
    const start = bars[first].start;
    const duration = (bars[last].end - start) * 0.97;
    for (const midi of [root, third, root + 7]) notes.push({ start, duration, midi: midi + 12 });
  }
  return { bars, notes, seconds: tabEnd(bars) };
}

/**
 * A band's performance with each bar played for `recordedLengths[k]` seconds. A bar played faster or slower than the
 * tab's has its notes stretched evenly across it, and a note that is held past the bar line is stretched with the bars it
 * crosses, so a sustained chord follows the band. A length of zero skips the bar; a length a second or more over the tab's
 * adds unrelated playing after it. The true anchor of every bar is returned with the recording's notes.
 */
export function performanceOf(tab: TabFixture, recordedLengths: readonly number[], lead = 0, extraSeed = 4242): Performance {
  const extra = recordedLengths.some((length, k) => length - (tab.bars[k].end - tab.bars[k].start) >= 1);
  if (extra) return bandPerformance(tab.notes, tab.bars, recordedLengths, lead, extraSeed);
  const anchors: number[] = [];
  let at = lead;
  for (const length of recordedLengths) {
    anchors.push(at);
    at += Math.max(0, length);
  }
  const endAnchor = at;
  const barOf = (time: number): number => {
    for (let k = tab.bars.length - 1; k >= 0; k--) if (time >= tab.bars[k].start - 1e-9) return k;
    return 0;
  };
  const toRecording = (time: number): number => {
    const k = Math.min(barOf(time), tab.bars.length - 1);
    const bar = tab.bars[k];
    const into = (time - bar.start) / (bar.end - bar.start);
    return anchors[k] + into * Math.max(0, recordedLengths[k]);
  };
  const notes: SongNote[] = [];
  for (const n of tab.notes) {
    const k = barOf(n.start);
    if (recordedLengths[k] <= 0) continue; // a skipped bar drops its notes
    const start = toRecording(n.start);
    const end = toRecording(Math.min(n.start + n.duration, tab.seconds - 1e-6));
    if (end > start) notes.push({ start, duration: end - start, midi: n.midi });
  }
  return { notes, seconds: endAnchor + 0.5, anchors, endAnchor };
}

/** The bars as the matcher takes them. */
export const spansOf = (bars: readonly BarShape[]): BarSpan[] => bars.map((b) => ({ start: b.start, end: b.end }));

/** A band that plays every bar at the tab's length, from `lead` seconds in. */
export const steadyLengths = (bars: readonly BarShape[]): number[] => bars.map((b) => b.end - b.start);

/** A band whose bar length drifts: each bar `1 + amount * sin(k / period)` times the tab's, so the error would build up if bars were fitted whole. */
export function driftingLengths(bars: readonly BarShape[], amount = 0.03, period = 6): number[] {
  return bars.map((b, k) => (b.end - b.start) * (1 + amount * Math.sin(k / period)));
}

export interface AccuracyReport {
  /** Absolute error of each compared bar, in seconds; bars the recording skips are left out. */
  readonly errors: number[];
  /** Share of compared bars within 20, 40 and 100 ms. */
  readonly within20: number;
  readonly within40: number;
  readonly within100: number;
  readonly median: number;
  readonly worst: number;
}

const shareWithin = (errors: readonly number[], limit: number): number =>
  errors.length === 0 ? 0 : errors.filter((e) => e <= limit + 1e-9).length / errors.length;

/**
 * How close detected anchors land to the truth. `skipped` bars (the recording does not play them) are not compared,
 * since they have no position of their own.
 */
export function accuracyOf(found: readonly number[], truth: readonly number[], skipped: readonly boolean[] = []): AccuracyReport {
  const errors: number[] = [];
  truth.forEach((t, k) => {
    if (skipped[k]) return;
    errors.push(Math.abs(found[k] - t));
  });
  const sorted = [...errors].sort((a, b) => a - b);
  return {
    errors,
    within20: shareWithin(errors, 0.02),
    within40: shareWithin(errors, 0.04),
    within100: shareWithin(errors, 0.1),
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    worst: sorted.length ? sorted[sorted.length - 1] : 0,
  };
}

/**
 * Where bar `k` would sit if it were predicted from the bars either side of it alone: the neighbours' anchors,
 * interpolated by the tab's own bar lengths. Comparing this with the bar's own value shows how well a stretch
 * agrees with itself without any ground truth.
 */
export function predictFromNeighbours(anchors: readonly number[], bars: readonly BarShape[], k: number): number | null {
  if (k <= 0 || k >= bars.length - 1) return null;
  const before = anchors[k - 1];
  const after = anchors[k + 1];
  const whole = bars[k + 1].start - bars[k - 1].start;
  if (whole <= 0) return null;
  return before + ((bars[k].start - bars[k - 1].start) / whole) * (after - before);
}

/**
 * Held-out error: for each bar in `among` (the bars with a firm onset on a real recording), the distance between its
 * value and the prediction from its neighbours with its own evidence hidden.
 */
export function heldOutErrors(anchors: readonly number[], bars: readonly BarShape[], among: readonly number[]): number[] {
  const out: number[] = [];
  for (const k of among) {
    const predicted = predictFromNeighbours(anchors, bars, k);
    if (predicted !== null) out.push(Math.abs(predicted - anchors[k]));
  }
  return out;
}
