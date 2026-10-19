// How much a note is drawn larger so the player can see which one to play and when. Shared by the
// highway and the fretboard, and driven only by the playback time, so it stays on the beat at any
// tempo and across loops.

import { isSounding } from './sounding';

/** Seconds before a note starts in which it begins to swell. */
export const APPROACH_SECONDS = 0.5;
/** The attack pop fades with this time constant. */
const POP_SECONDS = 0.15;

const APPROACH_GROWTH = 0.12;
const SOUNDING_GROWTH = 0.25;
const POP_GROWTH = 0.3;

export interface Emphasis {
  /** Size multiplier: 1 when the note is far off or done. */
  readonly scale: number;
  /** 1 at the instant the note starts, decaying to 0; drives the glow. */
  readonly pop: number;
}

const IDLE: Emphasis = { scale: 1, pop: 0 };

/**
 * Eases up over the last half second before the note, jumps at its start, settles while it
 * sounds, and returns to normal size when it is over.
 */
export function emphasisAt(startSeconds: number, endSeconds: number, t: number): Emphasis {
  const until = startSeconds - t;
  if (until > 0) {
    if (until >= APPROACH_SECONDS) return IDLE;
    return { scale: 1 + APPROACH_GROWTH * (1 - until / APPROACH_SECONDS), pop: 0 };
  }
  const since = -until;
  if (!isSounding({ startSeconds, endSeconds }, t)) return IDLE;
  const pop = Math.exp(-since / POP_SECONDS);
  return { scale: 1 + SOUNDING_GROWTH + POP_GROWTH * pop, pop };
}
