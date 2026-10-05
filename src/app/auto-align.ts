import type { AnalysisResult } from '../alignment/analyze';
import type { AlignmentMap } from '../audio/alignment-map';

/** What the alignment panel says about the loaded recording. */
export type AlignStatus =
  | { readonly phase: 'idle' }
  /** The recording is loaded and detection is waiting for the tab's sound to finish loading. */
  | { readonly phase: 'waiting' }
  | { readonly phase: 'analysing'; readonly progress: number }
  | { readonly phase: 'found'; readonly sections: number }
  | { readonly phase: 'not-found'; readonly reason: 'too-long' | 'silent' | 'not-confident' | 'out-of-range' }
  | { readonly phase: 'failed'; readonly reason: 'decode' | 'render' | 'worker' | 'no-sound' }
  /** A result arrived after the user had already moved the offset, so it was not applied. */
  | { readonly phase: 'discarded' }
  /** The offset was set by hand, or the user reverted to it. */
  | { readonly phase: 'manual' };

/**
 * Whether a recording that has just loaded is analysed. Anything the user already decided wins: a saved profile
 * (an alignment is restored, and an offset saved before alignment existed counts as set by hand) and an offset
 * the user has moved since the recording loaded both skip detection. Re-analyse is always available.
 */
export function decideAutoAlign(ctx: { hasProfile: boolean; offsetMoved: boolean }): 'run' | 'skip' {
  return ctx.hasProfile || ctx.offsetMoved ? 'skip' : 'run';
}

export interface Settled {
  /** The alignment to apply, or null when nothing changes. */
  readonly map: AlignmentMap | null;
  readonly status: AlignStatus;
}

/**
 * What to do with a finished analysis. A result for a recording that is no longer loaded, or a cancelled run,
 * is ignored (null); a result is not applied over an offset the user moved while it ran.
 */
export function settleAnalysis(ctx: { stillCurrent: boolean; offsetMoved: boolean }, result: AnalysisResult): Settled | null {
  if (!ctx.stillCurrent || result.kind === 'cancelled') return null;
  switch (result.kind) {
    case 'aligned':
      return ctx.offsetMoved
        ? { map: null, status: { phase: 'discarded' } }
        : { map: result.map, status: { phase: 'found', sections: result.map.holds.length } };
    case 'not-found':
      return { map: null, status: { phase: 'not-found', reason: result.reason } };
    case 'failed':
      return { map: null, status: { phase: 'failed', reason: result.reason } };
  }
}
