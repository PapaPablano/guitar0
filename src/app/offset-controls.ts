import { NUDGE_COARSE_SECONDS, NUDGE_FINE_SECONDS, clampOffset } from '../audio/offset-range';

export type NudgeSize = 'fine' | 'coarse';

/** Moves the offset one nudge step either way, kept in range and rounded to the 10 ms step. */
export function nudgeOffset(current: number, size: NudgeSize, direction: 1 | -1): number {
  const step = size === 'fine' ? NUDGE_FINE_SECONDS : NUDGE_COARSE_SECONDS;
  const next = Math.round((current + direction * step) / NUDGE_FINE_SECONDS) * NUDGE_FINE_SECONDS;
  // Round again to strip the float noise the multiplication leaves.
  return clampOffset(Number(next.toFixed(2)));
}

/** What the offset means for the listener; zero (within half a step) is stated on its own. */
export function offsetDirectionLabel(offsetSeconds: number): string {
  if (Math.abs(offsetSeconds) < NUDGE_FINE_SECONDS / 2) return 'in sync with the tab';
  return offsetSeconds < 0 ? 'recording starts later' : 'recording starts earlier';
}

/** The offset controls follow the recording alone: not the desktop bridge, not stems. */
export function offsetControlsVisible(state: { hasRecording: boolean }): boolean {
  return state.hasRecording;
}
