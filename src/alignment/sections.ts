import type { BarSpan } from '../audio/alignment-map';
import { CHROMA_BINS, CHROMA_RATE, type Chroma } from './features';

/** A run of tab bars the recording plays as one part of the song; repeats of a part share a letter. */
export interface Section {
  readonly firstBar: number;
  readonly lastBar: number;
  /** A, B, C… in the order each part first appears; a part that comes again keeps its letter. */
  readonly letter: string;
}

/** No section is shorter than this, so a passing change of chord is not a new part. */
export const MIN_SECTION_BARS = 4;
/** A song never shows more sections than this. */
export const MAX_SECTIONS = 12;

/** Bars on each side of a cut that are averaged, so a loop of chords looks the same wherever its window starts. */
const WINDOW_BARS = 4;
/** How different the bars before a cut are from the bars after it, at least (1 minus their cosine), for a cut to count. */
const NOVELTY_MIN = 0.5;
/** A window whose pitch content is this close to the song's average has nothing to tell it from the rest. */
const FEATURELESS = 0.05;
/** Parts whose bars match at least this well, bar by bar, once the song's overall key is taken out, are the same part. */
const SAME_PART = 0.7;

const dot = (a: Float32Array, b: Float32Array): number => {
  let sum = 0;
  for (let k = 0; k < CHROMA_BINS; k++) sum += a[k] * b[k];
  return sum;
};

const unit = (v: Float32Array): Float32Array => {
  let norm = 0;
  for (let k = 0; k < CHROMA_BINS; k++) norm += v[k] * v[k];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  for (let k = 0; k < CHROMA_BINS; k++) v[k] /= norm;
  return v;
};

/**
 * The pitch content of each bar of the recording: the mean of its frames across the steady part of the bar, which
 * is as long as the tab's bar. Extra playing at the end of a long bar is left out so it does not look like a new part.
 * A bar with nothing in it takes the bar before's vector.
 */
function barVectors(recording: Chroma, bars: readonly BarSpan[], anchors: readonly number[], endAnchor: number): Float32Array[] {
  const vectors: Float32Array[] = [];
  for (let k = 0; k < bars.length; k++) {
    const from = anchors[k];
    const to = k + 1 < bars.length ? anchors[k + 1] : endAnchor;
    const span = Math.min(to - from, bars[k].end - bars[k].start);
    const first = Math.max(0, Math.ceil(from * CHROMA_RATE - 1e-6));
    const last = Math.min(recording.count, Math.floor((from + span) * CHROMA_RATE));
    const sum = new Float32Array(CHROMA_BINS);
    for (let f = first; f < last; f++) for (let b = 0; b < CHROMA_BINS; b++) sum[b] += recording.frames[f * CHROMA_BINS + b];
    vectors.push(unit(sum));
  }
  for (let k = 1; k < vectors.length; k++) if (dot(vectors[k], vectors[k]) === 0) vectors[k] = vectors[k - 1];
  return vectors;
}

/** How alike two parts are, bar by bar from their starts, allowing the cuts to be a bar out of step. */
function partSimilarity(raw: readonly Float32Array[], a: { first: number; last: number }, b: { first: number; last: number }): number {
  const length = Math.min(a.last - a.first, b.last - b.first); // one bar shorter, so a shift stays inside both
  if (length < 1) return 0;
  let best = 0;
  for (let shift = -1; shift <= 1; shift++) {
    let sum = 0;
    let count = 0;
    for (let d = 0; d < length; d++) {
      const i = a.first + d + Math.max(shift, 0);
      const j = b.first + d + Math.max(-shift, 0);
      if (i > a.last || j > b.last) continue;
      sum += dot(raw[i], raw[j]);
      count += 1;
    }
    if (count > 0) best = Math.max(best, sum / count);
  }
  return best;
}

/**
 * Finds the parts of the song as the recording plays them. Each bar's pitch content is averaged over four bars, so
 * a loop of chords is steady inside a part; a part ends where the bars after it stop looking like the bars before. The
 * strongest cuts are kept, at least four bars apart and at most twelve parts in all, and parts that play the same
 * bars again share a letter. A song with no cut to find is one part.
 */
export function findSections(recording: Chroma, bars: readonly BarSpan[], anchors: readonly number[], endAnchor: number): Section[] {
  const count = bars.length;
  if (count === 0 || anchors.length !== count) return [];
  const whole: Section[] = [{ firstBar: 0, lastBar: count - 1, letter: 'A' }];
  if (count < 2 * MIN_SECTION_BARS) return whole;

  const raw = barVectors(recording, bars, anchors, endAnchor);
  // The four bars ending at each bar and the four starting at it: a cut between bars t-1 and t compares the two pure windows.
  const window = (from: number, to: number): Float32Array => {
    const sum = new Float32Array(CHROMA_BINS);
    for (let j = Math.max(0, from); j <= Math.min(count - 1, to); j++) for (let b = 0; b < CHROMA_BINS; b++) sum[b] += raw[j][b];
    return unit(sum);
  };
  const before = raw.map((_, i) => window(i - WINDOW_BARS + 1, i));
  const after = raw.map((_, i) => window(i, i + WINDOW_BARS - 1));
  // What every window has in common (the song's overall key) says nothing about where a part ends, so it is taken out.
  const mean = new Float32Array(CHROMA_BINS);
  for (let i = 0; i < count; i++) for (let b = 0; b < CHROMA_BINS; b++) mean[b] += (before[i][b] + after[i][b]) / (2 * count);
  const centre = (v: Float32Array): Float32Array => Float32Array.from(v, (x, b) => x - mean[b]);
  // Raw bars of unrelated parts already look alike (chords share notes and harmonics), so parts are compared with the shared key removed.
  const rawMean = new Float32Array(CHROMA_BINS);
  for (const v of raw) for (let b = 0; b < CHROMA_BINS; b++) rawMean[b] += v[b] / count;
  const distinct = raw.map((v) => {
    const c = Float32Array.from(v, (x, b) => x - rawMean[b]);
    const n = Math.sqrt(dot(c, c));
    return n < FEATURELESS ? new Float32Array(CHROMA_BINS) : unit(c);
  });
  const norm = (v: Float32Array): number => Math.sqrt(dot(v, v));
  const strength = new Array<number>(count + 1).fill(0);
  for (let cut = MIN_SECTION_BARS; cut <= count - MIN_SECTION_BARS; cut++) {
    const a = centre(before[cut - 1]);
    const b = centre(after[cut]);
    const na = norm(a);
    const nb = norm(b);
    strength[cut] = na < FEATURELESS || nb < FEATURELESS ? 0 : 1 - dot(a, b) / (na * nb);
  }
  const candidates: number[] = [];
  for (let cut = MIN_SECTION_BARS; cut <= count - MIN_SECTION_BARS; cut++) {
    if (strength[cut] >= NOVELTY_MIN && strength[cut] >= strength[cut - 1] && strength[cut] > strength[cut + 1]) candidates.push(cut);
  }
  candidates.sort((a, b) => strength[b] - strength[a]);
  const cuts: number[] = [];
  for (const cut of candidates) {
    if (cuts.length >= MAX_SECTIONS - 1) break;
    if (cuts.every((c) => Math.abs(c - cut) >= MIN_SECTION_BARS)) cuts.push(cut);
  }
  if (cuts.length === 0) return whole;
  cuts.sort((a, b) => a - b);

  const edges = [0, ...cuts, count];
  const parts = edges.slice(0, -1).map((first, n) => ({ first, last: edges[n + 1] - 1 }));
  const reps: { first: number; last: number; letter: string }[] = [];
  return mergeNeighbours(
    parts.map((part) => {
      const same = reps.find((r) => partSimilarity(distinct, r, part) >= SAME_PART);
      const letter = same ? same.letter : String.fromCharCode(65 + reps.length);
      if (!same) reps.push({ ...part, letter });
      return { firstBar: part.first, lastBar: part.last, letter };
    }),
  );
}

/** Two parts next to each other with the same letter are one part that a stray cut split. */
export function mergeNeighbours(sections: readonly Section[]): Section[] {
  const merged: Section[] = [];
  for (const s of sections) {
    const last = merged[merged.length - 1];
    if (last && last.letter === s.letter) merged[merged.length - 1] = { ...last, lastBar: s.lastBar };
    else merged.push({ ...s });
  }
  return merged;
}
