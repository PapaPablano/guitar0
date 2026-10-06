import { AlignmentMap, type BarSpan } from '../audio/alignment-map';
import { OFFSET_MAX_SECONDS } from '../audio/offset-range';
import { CHROMA_BINS, CHROMA_RATE, ONSET_RATE, type Chroma } from './features';

/** What the tab says about one played bar beyond where it starts and ends: the whole-song pass reads tempo and meter steadiness from it. */
export interface BarFacts {
  readonly tempo: number;
  /** Beats in the bar (the time signature's numerator). */
  readonly beats: number;
  /** The bar's place in the score; a score bar the tab plays twice carries the same number on both passes. */
  readonly scoreBar: number;
}

export interface MatchInput {
  /** Pitch-class frames of the recording and of the tab's render, at `CHROMA_RATE` frames per second. */
  readonly recording: Chroma;
  readonly tab: Chroma;
  /** Onset envelopes of the same two signals, at `ONSET_RATE` values per second. */
  readonly recordingOnsets: Float32Array;
  readonly tabOnsets: Float32Array;
  /** The tab's played bars, in tab seconds; every bar gets an anchor. */
  readonly bars: readonly BarSpan[];
  /** One record per bar of `bars`; absent for callers that do not pass the tab's tempo and meter. */
  readonly barFacts?: readonly BarFacts[];
}

export type MatchResult =
  | {
      readonly kind: 'aligned';
      readonly map: AlignmentMap;
      /** How far the best offset stands out from the rest, in standard deviations (the BBC finder's standard score). */
      readonly confidence: number;
      /** Share of the tab's sounding frames that the path matched to the recording. */
      readonly matchedFraction: number;
      /** Stretches where the recording skips bars the tab has; the tab jumps past them. */
      readonly skippedStretches: number;
      /** How clearly each bar's anchor was found on the recording's onsets, as a standard score; 0 where it kept the path's value. */
      readonly barConfidence: readonly number[];
      /** Whether the path matched most of each bar's sounding frames; false for a stretch played differently. */
      readonly barMatched: readonly boolean[];
    }
  | { readonly kind: 'not-found'; readonly reason: 'silent' | 'not-confident' | 'out-of-range' };

/**
 * Tuning, set on the synthetic fixtures in `tests/alignment/match.test.ts`; the reason for each value is beside it.
 */
export const MATCH_OPTIONS = {
  /** A frame pair counts as a match above this cosine similarity. Unrelated chords sit around 0.3 to 0.7, the same chord in another timbre above 0.85. */
  matchThreshold: 0.7,
  /** Cost per frame of the recording playing on while the tab waits: cheaper than a mismatched frame, so extra playing is not forced onto the tab. */
  holdGap: 0.12,
  /** Cost per frame of the tab running on while the recording does not (bars the recording skips): dear, since it is not a feature. */
  skipGap: 0.5,
  /** A bar recorded this much longer than the tab's is extra playing, and this much shorter is skipped playing. */
  minHoldSeconds: 1,
  /** How far either side of the estimated offset line the path may wander; extra playing beyond this is not followed. */
  bandSeconds: 120,
  /** The onset stage may move an anchor this far from the path's value. */
  fineSeconds: 0.15,
  /** Least share of sounding tab frames that must be matched. */
  minMatchedFraction: 0.3,
  /** Standard score of the best offset that is convincing on its own. */
  minProminence: 4,
  /** A lower score still counts when most of the tab was matched: a song built from repeating loops has several nearly equal offsets, which lowers the score of the right one. */
  floorProminence: 2,
  /** The share of sounding tab frames matched that makes a score between the floor and `minProminence` enough. */
  confidentMatched: 0.6,
  /** How much of each bar's start the onset stage compares: long enough for a few notes, short enough to stay inside the bar. */
  anchorWindowSeconds: 1.5,
  /** A bar counts as matched while its mean similarity is within this of the typical bar's. */
  matchedMargin: 0.2,
  /** Least standard score of the onset peak for a refinement to replace the path's value. */
  anchorPeakMin: 3,
  /** A refinement closer than this to where the previous bar's steady run predicts is snapped to it, so a steady band shows no step; the error it allows never builds up past this. */
  snapSeconds: 0.02,
  /** How many bars either side of an unpinned bar are averaged with it. */
  settleBars: 3,
  /** How far a bar's offset may sit from its neighbours' median and still count as the same steady stretch. */
  settleSeconds: 0.15,
} as const;

type Options = typeof MATCH_OPTIONS;

const dot = (a: Float32Array, ia: number, b: Float32Array, ib: number): number => {
  let sum = 0;
  const oa = ia * CHROMA_BINS;
  const ob = ib * CHROMA_BINS;
  for (let k = 0; k < CHROMA_BINS; k++) sum += a[oa + k] * b[ob + k];
  return sum;
};

function silentFrames(chroma: Chroma): Uint8Array {
  const silent = new Uint8Array(chroma.count);
  for (let i = 0; i < chroma.count; i++) {
    let any = 0;
    for (let k = 0; k < CHROMA_BINS; k++) any += chroma.frames[i * CHROMA_BINS + k];
    silent[i] = any === 0 ? 1 : 0;
  }
  return silent;
}

/** The lag, in frames, at which the recording lines up best with the tab, and how clearly that stands out. */
function coarseLag(rec: Chroma, tab: Chroma): { lag: number; prominence: number } | null {
  const maxLag = Math.round(OFFSET_MAX_SECONDS * CHROMA_RATE);
  const sums: number[] = [];
  const overlaps: number[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const from = Math.max(0, -lag);
    const to = Math.min(tab.count, rec.count - lag);
    let sum = 0;
    for (let j = from; j < to; j++) sum += dot(rec.frames, j + lag, tab.frames, j);
    sums.push(sum);
    overlaps.push(Math.max(0, to - from));
  }
  const minOverlap = 2 * CHROMA_RATE;
  let meanSim = 0;
  let valid = 0;
  for (let n = 0; n < sums.length; n++) {
    if (overlaps[n] < minOverlap) continue;
    meanSim += sums[n] / overlaps[n];
    valid += 1;
  }
  if (valid === 0) return null;
  meanSim /= valid;
  // Score each lag by how much more similar its frames are than frames of any two unrelated places.
  const scores: number[] = [];
  const lags: number[] = [];
  for (let n = 0; n < sums.length; n++) {
    if (overlaps[n] < minOverlap) continue;
    scores.push(sums[n] - overlaps[n] * meanSim);
    lags.push(n - maxLag);
  }
  let best = 0;
  for (let n = 1; n < scores.length; n++) if (scores[n] > scores[best]) best = n;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / scores.length;
  return { lag: lags[best], prominence: (scores[best] - mean) / (Math.sqrt(variance) || 1) };
}

interface PathCell {
  readonly tab: number;
  readonly rec: number;
  readonly move: 1 | 2 | 3;
}

/**
 * Local alignment of the recording's frames to the tab's in a band around `lag`: diagonal steps match frames,
 * horizontal steps are extra playing in the recording, vertical steps are bars the recording skips. The best
 * scoring path, from anywhere to anywhere, is returned from first cell to last.
 */
function alignPath(rec: Chroma, tab: Chroma, recSilent: Uint8Array, tabSilent: Uint8Array, lag: number, o: Options): PathCell[] {
  const half = Math.round(o.bandSeconds * CHROMA_RATE);
  const width = 2 * half + 1;
  const moves = new Uint8Array(tab.count * width);
  let previous = new Float32Array(width);
  let current = new Float32Array(width);
  let best = 0;
  let bestJ = -1;
  let bestK = -1;
  for (let j = 0; j < tab.count; j++) {
    current.fill(0);
    for (let k = 0; k < width; k++) {
      const i = j + lag + k - half;
      if (i < 0 || i >= rec.count) continue;
      // Two silent frames neither match nor mismatch, so a rest in both does not cut the path.
      let step: number;
      if (recSilent[i] && tabSilent[j]) step = 0;
      else if (recSilent[i] || tabSilent[j]) step = -o.matchThreshold;
      else step = dot(rec.frames, i, tab.frames, j) - o.matchThreshold;
      const diagonalFrom = j > 0 ? previous[k] : 0;
      let value = diagonalFrom + step;
      let move = 1;
      if (value <= 0) {
        value = 0;
        move = 0;
      }
      const left = k > 0 ? current[k - 1] : 0;
      if (left > 0 && left - o.holdGap > value) {
        value = left - o.holdGap;
        move = 2;
      }
      const below = j > 0 && k < width - 1 ? previous[k + 1] : 0;
      if (below > 0 && below - o.skipGap > value) {
        value = below - o.skipGap;
        move = 3;
      }
      current[k] = value;
      moves[j * width + k] = value > 0 ? move : 0;
      if (value > best) {
        best = value;
        bestJ = j;
        bestK = k;
      }
    }
    [previous, current] = [current, previous];
  }
  const path: PathCell[] = [];
  let j = bestJ;
  let k = bestK;
  while (j >= 0 && k >= 0 && k < width) {
    const move = moves[j * width + k];
    if (move === 0) break;
    path.push({ tab: j, rec: j + lag + k - half, move: move as 1 | 2 | 3 });
    if (move === 1) j -= 1;
    else if (move === 2) k -= 1;
    else {
      j -= 1;
      k += 1;
    }
  }
  return path.reverse();
}

/** What the path says about the recording at each tab frame. */
interface Coverage {
  startTab: number;
  endTab: number;
  /** The recording frame reached at each tab frame: the last cell there, so a wait is passed to its end. */
  rec: Int32Array;
  /** Offsets (recording minus tab, in frames) of the first and last matched cells, for what the path does not cover. */
  firstOffset: number;
  lastOffset: number;
}

function coverageOf(path: PathCell[]): Coverage | null {
  const diagonals = path.filter((c) => c.move === 1);
  if (diagonals.length === 0) return null;
  const startTab = path[0].tab;
  const endTab = path[path.length - 1].tab;
  const rec = new Int32Array(endTab + 1).fill(-1);
  for (const cell of path) rec[cell.tab] = cell.rec;
  return {
    startTab,
    endTab,
    rec,
    firstOffset: diagonals[0].rec - diagonals[0].tab,
    lastOffset: diagonals[diagonals.length - 1].rec - diagonals[diagonals.length - 1].tab,
  };
}

/** The recording second at which the tab reaches `line`, from the path, continuing at the path's end offsets outside it. */
function recordingAt(line: number, cover: Coverage): number {
  const frame = line * CHROMA_RATE;
  const nearest = Math.round(frame);
  if (nearest < cover.startTab) return (frame + cover.firstOffset) / CHROMA_RATE;
  if (nearest > cover.endTab) return (frame + cover.lastOffset) / CHROMA_RATE;
  let at = cover.rec[nearest];
  for (let back = nearest; at < 0 && back > cover.startTab; ) at = cover.rec[--back];
  return (at + (frame - nearest)) / CHROMA_RATE;
}

/**
 * Sharpens one bar's anchor on the onsets: the lag, within `fineSeconds` of the path's value, at which the tab's
 * first notes of the bar best line up with the recording's. The prominence is the height of that peak over the
 * other lags in standard deviations (the BBC finder's standard score); 0 when the tab has no onsets there.
 */
function refineAnchor(barStart: number, guess: number, input: MatchInput, o: Options): { seconds: number; prominence: number } {
  const a = Math.round(barStart * ONSET_RATE);
  const b = Math.min(a + Math.round(o.anchorWindowSeconds * ONSET_RATE), input.tabOnsets.length);
  const centre = Math.round((guess - barStart) * ONSET_RATE);
  const reach = Math.round(o.fineSeconds * ONSET_RATE);
  let energy = 0;
  for (let t = a; t < b; t++) energy += input.tabOnsets[t];
  if (b - a < ONSET_RATE / 4 || energy <= 1e-9) return { seconds: guess, prominence: 0 };
  const scores: number[] = [];
  for (let lag = -reach; lag <= reach; lag++) {
    let score = 0;
    for (let t = a; t < b; t++) {
      const r = t + centre + lag;
      if (r >= 0 && r < input.recordingOnsets.length) score += input.tabOnsets[t] * input.recordingOnsets[r];
    }
    scores.push(score);
  }
  let best = 0;
  for (let n = 1; n < scores.length; n++) if (scores[n] > scores[best]) best = n;
  const mean = scores.reduce((x, y) => x + y, 0) / scores.length;
  const std = Math.sqrt(scores.reduce((x, y) => x + (y - mean) * (y - mean), 0) / scores.length);
  return { seconds: barStart + (centre + best - reach) / ONSET_RATE, prominence: std > 0 ? (scores[best] - mean) / std : 0 };
}

/**
 * A bar the onsets could not pin down keeps the path's value, and the path moves in whole frames, so from one bar to the
 * next it can flip between two neighbouring offsets even when the band is steady. Each such bar takes the mean offset of the
 * bars around it that sit within a frame and a half of it, which is finer than a frame and leaves a real jump (extra
 * or skipped playing, a change of tempo) alone because the bars across it are not counted.
 */
function settleUnpinned(raw: number[], bars: readonly BarSpan[], confidence: readonly number[], fromPath: readonly number[], o: Options): void {
  const offsets = raw.map((anchor, k) => anchor - bars[k].start);
  const skipped = bars.map((_, k) => k + 1 < bars.length && fromPath[k + 1] - fromPath[k] < 0.1);
  const reach = o.settleBars;
  const tolerance = o.settleSeconds;
  for (let k = 0; k < bars.length; k++) {
    if (confidence[k] > 0 || skipped[k]) continue;
    const near: number[] = [];
    for (let j = Math.max(0, k - reach); j <= Math.min(bars.length - 1, k + reach); j++) if (!skipped[j]) near.push(offsets[j]);
    const sorted = [...near].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (Math.abs(offsets[k] - median) > tolerance) continue;
    const alike = near.filter((offset) => Math.abs(offset - median) <= tolerance);
    raw[k] = bars[k].start + alike.reduce((sum, offset) => sum + offset, 0) / alike.length;
  }
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Runs of path cells of one kind: a wait (the recording plays on at one tab frame) or a skip (the tab runs on at one recording frame). */
function runsOf(path: PathCell[], move: 2 | 3, minFrames: number): { first: PathCell; last: PathCell; length: number }[] {
  const runs: { first: PathCell; last: PathCell; length: number }[] = [];
  let first: PathCell | null = null;
  let last: PathCell | null = null;
  let length = 0;
  const close = () => {
    if (first && last && length >= minFrames) runs.push({ first, last, length });
    first = null;
    last = null;
    length = 0;
  };
  for (const cell of path) {
    if (cell.move === move) {
      if (!first) first = cell;
      last = cell;
      length += 1;
    } else close();
  }
  close();
  return runs;
}

/** How far, in frames, an offset may sit from the bar's median and still count as the same steady stretch. */
const CLUSTER_FRAMES = 1.5;

/**
 * One anchor for a bar from the diagonal cells of the path inside it: the offset of those cells, taken from the bar's
 * start. A bar's notes play steadily, so this is steadier than the path's value at the bar line, which wobbles where
 * extra playing begins; and when a wait falls inside the bar, the side holding most of its cells decides which line the
 * extra playing belongs to, which is the nearest one. Matched cells are preferred.
 * Returns null for a bar with no diagonal cells.
 */
function anchorFromCells(
  bar: BarSpan,
  path: PathCell[],
  cellRange: { from: number; to: number },
  similar: (cell: PathCell) => boolean,
): number | null {
  const all: number[] = [];
  const good: number[] = [];
  for (let n = cellRange.from; n < cellRange.to; n++) {
    const cell = path[n];
    if (cell.move !== 1) continue;
    all.push(cell.rec - cell.tab);
    if (similar(cell)) good.push(cell.rec - cell.tab);
  }
  const offsets = good.length >= 3 ? good : all;
  if (offsets.length === 0) return null;
  offsets.sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)];
  // The path moves in whole frames, so the median can only land on the frame grid. The offsets that stay near it are
  // one steady stretch, and their mean is finer than a frame where the path wobbles between two neighbouring offsets.
  const steady = offsets.filter((offset) => Math.abs(offset - median) <= CLUSTER_FRAMES);
  const mean = steady.reduce((sum, offset) => sum + offset, 0) / steady.length;
  return bar.start + mean / CHROMA_RATE;
}

/**
 * A stretch where the tab runs on and the recording does not is skipped playing; the bars it mostly covers have no
 * recorded length, so each takes the anchor of the first bar after them.
 */
function placeSkipsOnBars(anchors: number[], path: PathCell[], bars: readonly BarSpan[], minFrames: number, endAnchor: number): void {
  const skipped = new Array<boolean>(bars.length).fill(false);
  for (const skip of runsOf(path, 3, minFrames)) {
    const from = (skip.first.tab - 1) / CHROMA_RATE;
    const to = skip.last.tab / CHROMA_RATE;
    bars.forEach((b, k) => {
      const overlap = Math.min(b.end, to) - Math.max(b.start, from);
      if (overlap >= (b.end - b.start) / 2) skipped[k] = true;
    });
  }
  for (let k = bars.length - 1; k >= 0; k--) {
    if (skipped[k]) anchors[k] = k + 1 < bars.length ? anchors[k + 1] : endAnchor;
  }
}

/**
 * Whether each bar was matched: its mean pitch-content similarity is within a margin of the recording's typical
 * bar. Relative, because a real recording of a MIDI render never matches as closely as a synthetic one does.
 * A bar the path did not cross has nothing to compare and is not matched.
 */
function barMatchedFlags(sums: readonly number[], counts: readonly number[], margin: number): boolean[] {
  const means = sums.map((s, k) => (counts[k] > 0 ? s / counts[k] : -1));
  const present = means.filter((m) => m >= 0).sort((a, b) => a - b);
  if (present.length === 0) return means.map(() => false);
  const typical = present[Math.floor(present.length / 2)];
  return means.map((m) => m >= 0 && m >= typical - margin);
}

/**
 * Finds where a recording sits against the tab, one anchor per bar. The anchors are read off one path through
 * the two signals' pitch content (the BBC offset finder and Audalign only find a single offset), then each is
 * sharpened on the onsets to about 10 ms and scored, matching bar by bar as pyCrossfade does. Returns not-found
 * when the match is not convincing.
 */
export function matchRecording(input: MatchInput, options: Partial<Options> = {}): MatchResult {
  const o: Options = { ...MATCH_OPTIONS, ...options };
  const { recording, tab, bars } = input;
  const recSilent = silentFrames(recording);
  const tabSilent = silentFrames(tab);
  const sounding = tabSilent.reduce((n, s) => n + (s ? 0 : 1), 0);
  if (sounding === 0 || recSilent.every((s) => s === 1) || bars.length === 0) return { kind: 'not-found', reason: 'silent' };

  const coarse = coarseLag(recording, tab);
  if (!coarse || coarse.prominence < o.floorProminence) return { kind: 'not-found', reason: 'not-confident' };

  const path = alignPath(recording, tab, recSilent, tabSilent, coarse.lag, o);
  const cover = coverageOf(path);
  if (!cover) return { kind: 'not-found', reason: 'not-confident' };

  // How much of each bar the path matched, and how much of the whole tab.
  const barSimilaritySum = new Array<number>(bars.length).fill(0);
  const barSimilarityCount = new Array<number>(bars.length).fill(0);
  const barOfFrame = (frame: number): number => {
    const t = frame / CHROMA_RATE;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].start <= t + 1e-9) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  let matched = 0;
  for (const cell of path) {
    if (cell.move !== 1 || tabSilent[cell.tab] || recSilent[cell.rec]) continue;
    const similarity = dot(recording.frames, cell.rec, tab.frames, cell.tab);
    const bar = barOfFrame(cell.tab);
    barSimilaritySum[bar] += similarity;
    barSimilarityCount[bar] += 1;
    if (similarity >= o.matchThreshold) matched += 1;
  }
  const matchedFraction = matched / sounding;
  if (matchedFraction < o.minMatchedFraction) return { kind: 'not-found', reason: 'not-confident' };
  if (coarse.prominence < o.minProminence && matchedFraction < o.confidentMatched) return { kind: 'not-found', reason: 'not-confident' };

  // One anchor per bar from the path, then sharpened on the onsets where that is convincing.
  const fromPath = bars.map((b) => recordingAt(b.start, cover));
  const endFromPath = recordingAt(bars[bars.length - 1].end, cover);
  // The path's cells are in tab order, so each bar's cells are one stretch of it.
  let cursor = 0;
  bars.forEach((bar, k) => {
    const from = cursor;
    while (cursor < path.length && path[cursor].tab / CHROMA_RATE < bar.end - 1e-9) cursor += 1;
    const median = anchorFromCells(bar, path, { from, to: cursor }, (cell) =>
      !tabSilent[cell.tab] && !recSilent[cell.rec] && dot(recording.frames, cell.rec, tab.frames, cell.tab) >= o.matchThreshold,
    );
    if (median !== null) fromPath[k] = median;
  });
  placeSkipsOnBars(fromPath, path, bars, Math.round(o.minHoldSeconds * CHROMA_RATE), endFromPath);
  const raw = fromPath.slice();
  const barConfidence = new Array<number>(bars.length).fill(0);
  for (let k = 0; k < bars.length; k++) {
    const skipped = k + 1 < bars.length && fromPath[k + 1] - fromPath[k] < 0.1;
    if (skipped) continue; // a bar the recording does not play has nothing to line up
    const refined = refineAnchor(bars[k].start, fromPath[k], input, o);
    if (refined.prominence >= o.anchorPeakMin && Math.abs(refined.seconds - fromPath[k]) <= o.fineSeconds + 1e-9) {
      raw[k] = refined.seconds;
      barConfidence[k] = refined.prominence;
    }
  }
  settleUnpinned(raw, bars, barConfidence, fromPath, o);
  // A band that is steady shows no steps: a refinement within a few milliseconds of where the previous bar's run predicts is that prediction.
  const anchors: number[] = [raw[0]];
  for (let k = 1; k < bars.length; k++) {
    const predicted = anchors[k - 1] + (bars[k - 1].end - bars[k - 1].start);
    anchors.push(Math.abs(raw[k] - predicted) < o.snapSeconds ? predicted : raw[k]);
  }
  const rounded = anchors.map(round2);
  for (let k = 1; k < rounded.length; k++) rounded[k] = Math.max(rounded[k], rounded[k - 1]);
  const endAnchor = round2(Math.max(endFromPath, rounded[rounded.length - 1]));

  if (Math.abs(rounded[0] - bars[0].start) > OFFSET_MAX_SECONDS) return { kind: 'not-found', reason: 'out-of-range' };
  const map = AlignmentMap.fromAnchors(bars, rounded, endAnchor);
  if (!map) return { kind: 'not-found', reason: 'not-confident' };

  // Stretches of bars the recording played much shorter than the tab's, which the tab jumps past.
  let skippedStretches = 0;
  let inSkip = false;
  for (let k = 0; k < bars.length; k++) {
    const recorded = (k + 1 < bars.length ? rounded[k + 1] : endAnchor) - rounded[k];
    const short = recorded < bars[k].end - bars[k].start - o.minHoldSeconds;
    if (short && !inSkip) skippedStretches += 1;
    inSkip = short;
  }
  return {
    kind: 'aligned',
    map,
    confidence: coarse.prominence,
    matchedFraction,
    skippedStretches,
    barConfidence,
    barMatched: barMatchedFlags(barSimilaritySum, barSimilarityCount, o.matchedMargin),
  };
}
