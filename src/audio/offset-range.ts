import { clamp } from './clock';

/**
 * The recording offset range shared by the clock, the slider and saved state. Negative means the
 * recording starts after the tab (silence first); positive means it starts before. Tunable.
 */
export const OFFSET_MIN_SECONDS = -30;
export const OFFSET_MAX_SECONDS = 30;
/** Nudge button sizes. */
export const NUDGE_FINE_SECONDS = 0.01;
export const NUDGE_COARSE_SECONDS = 0.1;

/** Keeps an offset inside the range; anything that is not a number becomes zero. */
export function clampOffset(seconds: number): number {
  if (Number.isNaN(seconds)) return 0;
  return clamp(seconds, OFFSET_MIN_SECONDS, OFFSET_MAX_SECONDS);
}
