/**
 * The whole-song pass: one offset per bar, found together. Every bar has an evidence curve over candidate offsets; a
 * bar with sharp onsets pins its own offset, and a bar without them takes the offset the bars around it imply. The
 * prior is that the band keeps a steady pace, so an offset moves along a line and a change of that line costs
 * something (a second difference of the offsets, which charges nothing for a band that runs steadily fast or slow).
 * A forward-backward pass over pairs of neighbouring offsets gives each bar the whole song's opinion of it, and the
 * spread of that opinion is the bar's uncertainty.
 */

/** Tuning, set on the generated recordings in `tests/alignment/whole-song.test.ts`; the reason for each value is beside it. */
export const WHOLE_SONG = {
  /** Typical timing wobble of a steady band against a bar of two seconds, which a change of pace may exceed. */
  sigmaSeconds: 0.02,
  /** The pace may not be known to better than this, however short the bar. */
  minSigmaSeconds: 0.008,
  /** The most a change of pace can cost, in nats: a real step (the band slows down, a part starts late) is allowed, at this price. */
  capNats: 8,
  /** The first step of the song has no earlier pace to compare with, so it is judged this many times more loosely. */
  firstStepMultiple: 4,
  /** Evidence for an offset is this times half the square of the curve's standard score there, in nats: a standard score of 6 is worth 9 nats, of 3 a little over 2. */
  evidenceWeight: 0.5,
  /** How far, in steps, either side of the best offset the reported offset averages. */
  meanReach: 3,
} as const;

export type WholeSongOptions = { readonly [K in keyof typeof WHOLE_SONG]: number };

/** One bar's input to the solve. */
export interface ChainBar {
  /** Candidate offsets in seconds, evenly spaced, the same count for every bar. */
  readonly offsets: Float64Array;
  /** Standard score of the evidence at each candidate; all zero for a bar with nothing to compare. */
  readonly z: Float64Array;
  /** Tab seconds from the previous bar in the chain to this one (any value for the first bar). */
  readonly gap: number;
  /** Greater than 1 where the tab changes tempo or meter, so the pace may change there more easily. */
  readonly looseness: number;
  /** The step into this bar crosses a run of extra or skipped playing, so the pace before it says nothing about the pace after. */
  readonly free: boolean;
}

export interface SolvedBar {
  /** The bar's offset, in seconds: the average of the whole-song opinion around its most likely value. */
  readonly offset: number;
  /** The standard deviation of that opinion, in seconds. */
  readonly spread: number;
}

/** The solve, deterministic and linear in the number of bars. */
export function solveChain(bars: readonly ChainBar[], options: Partial<WholeSongOptions> = {}): SolvedBar[] {
  const o: WholeSongOptions = { ...WHOLE_SONG, ...options };
  const K = bars.length;
  if (K === 0) return [];
  const N = bars[0].offsets.length;
  const step = N > 1 ? bars[0].offsets[1] - bars[0].offsets[0] : 1;
  const eps = Math.exp(-o.capNats);
  const reach = Math.sqrt(2 * o.capNats);

  const sigmaOf = (c: number): number => Math.max(o.minSigmaSeconds, (o.sigmaSeconds * bars[c].gap * bars[c].looseness) / 2);
  const emission = bars.map((bar) => {
    const e = new Float64Array(N);
    let top = -Infinity;
    const nats = (j: number): number => (o.evidenceWeight * Math.max(0, bar.z[j]) ** 2) / 2;
    for (let j = 0; j < N; j++) top = Math.max(top, nats(j));
    for (let j = 0; j < N; j++) e[j] = Math.exp(nats(j) - top);
    return e;
  });

  const finish = (weights: Float64Array, c: number): SolvedBar => {
    let total = 0;
    let best = 0;
    for (let j = 0; j < N; j++) {
      total += weights[j];
      if (weights[j] > weights[best]) best = j;
    }
    if (total <= 0) return { offset: bars[c].offsets[Math.floor(N / 2)], spread: Infinity };
    let sum = 0;
    let norm = 0;
    for (let j = Math.max(0, best - o.meanReach); j <= Math.min(N - 1, best + o.meanReach); j++) {
      sum += weights[j] * bars[c].offsets[j];
      norm += weights[j];
    }
    let mean = 0;
    for (let j = 0; j < N; j++) mean += (weights[j] / total) * bars[c].offsets[j];
    let variance = 0;
    for (let j = 0; j < N; j++) variance += (weights[j] / total) * (bars[c].offsets[j] - mean) ** 2;
    return { offset: sum / norm, spread: Math.sqrt(variance) };
  };

  if (K === 1) return [finish(emission[0], 0)];

  // The first step: bars 0 and 1, judged against no change at all, loosely.
  const alpha: Float64Array[] = new Array(K);
  alpha[1] = new Float64Array(N * N);
  {
    const sigma = o.firstStepMultiple * sigmaOf(1);
    const wide = sigma * reach;
    let sum = 0;
    for (let h = 0; h < N; h++) {
      for (let i = 0; i < N; i++) {
        let transition = 1;
        if (!bars[1].free) {
          const d = bars[1].offsets[i] - bars[0].offsets[h];
          transition = Math.abs(d) < wide ? Math.max(eps, Math.exp(-(d * d) / (2 * sigma * sigma))) : eps;
        }
        const value = emission[0][h] * emission[1][i] * transition;
        alpha[1][h * N + i] = value;
        sum += value;
      }
    }
    if (sum > 0) for (let n = 0; n < alpha[1].length; n++) alpha[1][n] /= sum;
  }

  /** Where the step into bar `c` is expected to land, given the offsets of the two bars before it: the pace carried on. */
  const predicted = (c: number, h: number, i: number): number => {
    const here = bars[c - 1].offsets[i];
    // A pace measured across a run says nothing about the next step.
    const carried = bars[c - 1].free || bars[c - 1].gap <= 0 ? 0 : ((here - bars[c - 2].offsets[h]) * bars[c].gap) / bars[c - 1].gap;
    return here + carried;
  };

  for (let c = 2; c < K; c++) {
    const previous = alpha[c - 1];
    const marginal = new Float64Array(N);
    for (let h = 0; h < N; h++) for (let i = 0; i < N; i++) marginal[i] += previous[h * N + i];
    const next = new Float64Array(N * N);
    if (bars[c].free) {
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) next[i * N + j] = marginal[i];
    } else {
      const sigma = sigmaOf(c);
      const wide = sigma * reach;
      const first = bars[c].offsets[0];
      for (let i = 0; i < N; i++) {
        const row = i * N;
        for (let j = 0; j < N; j++) next[row + j] = eps * marginal[i];
      }
      for (let h = 0; h < N; h++) {
        for (let i = 0; i < N; i++) {
          const a = previous[h * N + i];
          if (a < 1e-18) continue;
          const p = predicted(c, h, i);
          const from = Math.max(0, Math.ceil((p - wide - first) / step));
          const to = Math.min(N - 1, Math.floor((p + wide - first) / step));
          for (let j = from; j <= to; j++) {
            const d = bars[c].offsets[j] - p;
            const near = Math.exp(-(d * d) / (2 * sigma * sigma)) - eps;
            if (near > 0) next[i * N + j] += a * near;
          }
        }
      }
    }
    let sum = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        next[i * N + j] *= emission[c][j];
        sum += next[i * N + j];
      }
    }
    if (sum > 0) for (let n = 0; n < next.length; n++) next[n] /= sum;
    alpha[c] = next;
  }

  // Backward: how well each pair of neighbouring offsets explains everything after it.
  const beta: Float64Array[] = new Array(K);
  beta[K - 1] = new Float64Array(N * N).fill(1);
  for (let c = K - 2; c >= 1; c--) {
    const later = beta[c + 1];
    const out = new Float64Array(N * N);
    const emitted = emission[c + 1];
    const tail = new Float64Array(N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) tail[i] += emitted[j] * later[i * N + j];
    if (bars[c + 1].free) {
      for (let h = 0; h < N; h++) for (let i = 0; i < N; i++) out[h * N + i] = tail[i];
    } else {
      const sigma = sigmaOf(c + 1);
      const wide = sigma * reach;
      const first = bars[c + 1].offsets[0];
      for (let h = 0; h < N; h++) {
        for (let i = 0; i < N; i++) {
          // `c` is the pair (c - 1, c); stepping to bar c + 1 predicts from those two.
          const p = predicted(c + 1, h, i);
          let value = eps * tail[i];
          const from = Math.max(0, Math.ceil((p - wide - first) / step));
          const to = Math.min(N - 1, Math.floor((p + wide - first) / step));
          for (let j = from; j <= to; j++) {
            const d = bars[c + 1].offsets[j] - p;
            const near = Math.exp(-(d * d) / (2 * sigma * sigma)) - eps;
            if (near > 0) value += near * emitted[j] * later[i * N + j];
          }
          out[h * N + i] = value;
        }
      }
    }
    let sum = 0;
    for (let n = 0; n < out.length; n++) sum += out[n];
    if (sum > 0) for (let n = 0; n < out.length; n++) out[n] /= sum;
    beta[c] = out;
  }

  const solved: SolvedBar[] = [];
  const first = new Float64Array(N);
  for (let h = 0; h < N; h++) for (let i = 0; i < N; i++) first[h] += alpha[1][h * N + i] * beta[1][h * N + i];
  solved.push(finish(first, 0));
  for (let c = 1; c < K; c++) {
    const weights = new Float64Array(N);
    for (let h = 0; h < N; h++) for (let i = 0; i < N; i++) weights[i] += alpha[c][h * N + i] * beta[c][h * N + i];
    solved.push(finish(weights, c));
  }
  return solved;
}
