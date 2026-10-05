import { AlignmentMap, type Hold } from '../audio/alignment-map';
import { OFFSET_MAX_SECONDS } from '../audio/offset-range';
import { CHROMA_BINS, CHROMA_RATE, ONSET_RATE, type Chroma } from './features';

export interface MatchInput {
  /** Pitch-class frames of the recording and of the tab's render, at `CHROMA_RATE` frames per second. */
  readonly recording: Chroma;
  readonly tab: Chroma;
  /** Onset envelopes of the same two signals, at `ONSET_RATE` values per second. */
  readonly recordingOnsets: Float32Array;
  readonly tabOnsets: Float32Array;
  /** Tab seconds at which each played bar starts; extra sections are placed on one of these. */
  readonly barLines: readonly number[];
}

export type MatchResult =
  | {
      readonly kind: 'aligned';
      readonly map: AlignmentMap;
      /** How far the best offset stands out from the rest, in standard deviations (the BBC finder's standard score). */
      readonly confidence: number;
      /** Share of the tab's sounding frames that the path matched to the recording. */
      readonly matchedFraction: number;
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
  /** A shift of the offset smaller than this is timing noise, not an extra section. */
  minHoldSeconds: 1,
  /** How far either side of the estimated offset line the path may wander; extra playing beyond this is not followed. */
  bandSeconds: 120,
  /** The onset stage may move an edge this far from the coarse result. */
  fineSeconds: 0.15,
  /** Least share of sounding tab frames that must be matched. */
  minMatchedFraction: 0.3,
  /** Least standard score of the best offset. */
  minProminence: 4,
  /** A segment's offset is read from its first stretch, so a shift too small to count as a hold later on does not move it. */
  edgeSeconds: 10,
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

interface Segment {
  /** Tab frames the segment covers. */
  startTab: number;
  endTab: number;
  /** Offsets (recording minus tab, in frames) of its matched cells. */
  offsets: number[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Splits the path where the offset jumps by a second or more; a jump up is extra playing, a jump down is skipped bars. */
function segmentsOf(path: PathCell[], minJumpFrames: number): { segments: Segment[]; jumps: { before: number; delta: number }[] } {
  const segments: Segment[] = [];
  const jumps: { before: number; delta: number }[] = [];
  let lastOffset: number | null = null;
  let lastTab = 0;
  let current: Segment | null = null;
  for (const cell of path) {
    if (cell.move !== 1) continue;
    const offset = cell.rec - cell.tab;
    if (lastOffset !== null && Math.abs(offset - lastOffset) >= minJumpFrames && current) {
      segments.push(current);
      jumps.push({ before: lastTab, delta: offset - lastOffset });
      current = null;
    }
    if (!current) current = { startTab: cell.tab, endTab: cell.tab, offsets: [] };
    current.endTab = cell.tab;
    current.offsets.push(offset);
    lastOffset = offset;
    lastTab = cell.tab;
  }
  if (current) segments.push(current);
  return { segments, jumps };
}

/** The onset-envelope lag, in seconds within `fine`, that best lines the segment's tab span up with the recording. */
function refine(seg: Segment, offsetSeconds: number, input: MatchInput, fineSeconds: number, edgeSeconds: number): number {
  const a = Math.ceil((seg.startTab / CHROMA_RATE) * ONSET_RATE);
  const b = Math.min(Math.floor(((seg.endTab + 1) / CHROMA_RATE) * ONSET_RATE), a + Math.round(edgeSeconds * ONSET_RATE));
  if (b - a < ONSET_RATE) return offsetSeconds;
  const centre = Math.round(offsetSeconds * ONSET_RATE);
  const reach = Math.round(fineSeconds * ONSET_RATE);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = -reach; lag <= reach; lag++) {
    let score = 0;
    for (let t = a; t < b && t < input.tabOnsets.length; t++) {
      const r = t + centre + lag;
      if (r >= 0 && r < input.recordingOnsets.length) score += input.tabOnsets[t] * input.recordingOnsets[r];
    }
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return (centre + bestLag) / ONSET_RATE;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

function nearestBar(seconds: number, barLines: readonly number[]): number {
  if (barLines.length === 0) return round2(seconds);
  let best = barLines[0];
  for (const line of barLines) if (Math.abs(line - seconds) < Math.abs(best - seconds)) best = line;
  return best;
}

/**
 * Finds where a recording sits against the tab. The start offset and the extra sections come from one path
 * through the two signals' pitch content (the BBC offset finder and Audalign only find a single offset), then
 * onset correlation sharpens each edge to about 10 ms. Returns not-found when the match is not convincing.
 */
export function matchRecording(input: MatchInput, options: Partial<Options> = {}): MatchResult {
  const o: Options = { ...MATCH_OPTIONS, ...options };
  const { recording, tab } = input;
  const recSilent = silentFrames(recording);
  const tabSilent = silentFrames(tab);
  const sounding = tabSilent.reduce((n, s) => n + (s ? 0 : 1), 0);
  if (sounding === 0 || recSilent.every((s) => s === 1)) return { kind: 'not-found', reason: 'silent' };

  const coarse = coarseLag(recording, tab);
  if (!coarse || coarse.prominence < o.minProminence) return { kind: 'not-found', reason: 'not-confident' };

  const path = alignPath(recording, tab, recSilent, tabSilent, coarse.lag, o);
  let matched = 0;
  for (const cell of path) {
    if (cell.move === 1 && !tabSilent[cell.tab] && !recSilent[cell.rec] && dot(recording.frames, cell.rec, tab.frames, cell.tab) >= o.matchThreshold) matched += 1;
  }
  const matchedFraction = matched / sounding;
  if (matchedFraction < o.minMatchedFraction) return { kind: 'not-found', reason: 'not-confident' };

  const { segments, jumps } = segmentsOf(path, Math.round(o.minHoldSeconds * CHROMA_RATE));
  if (segments.length === 0) return { kind: 'not-found', reason: 'not-confident' };

  const edgeCells = Math.round(o.edgeSeconds * CHROMA_RATE);
  const offsets = segments.map((seg) =>
    round2(refine(seg, median(seg.offsets.slice(0, edgeCells)) / CHROMA_RATE, input, o.fineSeconds, o.edgeSeconds)),
  );
  const base = offsets[0];
  if (Math.abs(base) > OFFSET_MAX_SECONDS) return { kind: 'not-found', reason: 'out-of-range' };

  const holds: Hold[] = [];
  for (let n = 0; n < jumps.length; n++) {
    if (jumps[n].delta <= 0) continue; // bars the recording skips are not handled
    const length = round2(offsets[n + 1] - offsets[n]);
    if (length < o.minHoldSeconds) continue;
    const at = nearestBar((jumps[n].before + 0.5) / CHROMA_RATE, input.barLines);
    holds.push({ at, length });
  }
  return {
    kind: 'aligned',
    map: AlignmentMap.of(base, holds),
    confidence: coarse.prominence,
    matchedFraction,
  };
}
