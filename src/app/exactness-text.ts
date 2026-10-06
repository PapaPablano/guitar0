import type { ChunkState } from '../audio/recording-pcm';
import type { HoldState } from '../audio/user-audio';
import type { CopyState } from './exact-copy-load';

/**
 * What to tell the player about the exact copy of the recording; empty when there is nothing to say. The "up to about a second
 * off" warning belongs only to a recording that cannot get an exact copy at all.
 */
export function copyStateText(state: CopyState | null): string {
  switch (state) {
    case 'preparing':
      return 'Preparing an exact copy of the recording. A jump to a part that is not ready yet waits for it.';
    case 'failed':
      return 'An exact copy of the recording could not be made, so jumping around can land up to about a second off and throw the tab out of sync. Load a WAV version of the recording for exact jumps.';
    case 'too-long':
      return 'This recording is too long for an exact copy, so jumping around can land up to about a second off and throw the tab out of sync. Load a shorter, MP3 or WAV version of the recording for exact jumps.';
    default:
      return '';
  }
}

/** What to tell the player about a jump that is being held, a failed one included; empty when no jump is held. */
export function holdText(hold: HoldState | null): string {
  switch (hold?.phase) {
    case 'waiting':
      return 'Getting this part exact. The jump lands as soon as it is ready.';
    case 'paused':
      return 'Paused while this part is made exact. Playback resumes with a four-beat count-in.';
    case 'counting':
      return 'Counting in…';
    case 'failed':
      return 'This part could not be made exact, so the jump may have landed off.';
    default:
      return '';
  }
}

/** A run of chunks in one state, as fractions of the recording's length from 0 to 1. */
export interface StripSegment {
  readonly from: number;
  readonly to: number;
  readonly state: ChunkState;
}

/** The recording's chunk states as runs along its length, for the strip; the last chunk ends where the recording does. */
export function stripSegments(states: readonly ChunkState[], chunkSeconds: number, durationSeconds: number): StripSegment[] {
  const segments: StripSegment[] = [];
  if (durationSeconds <= 0) return segments;
  states.forEach((state, i) => {
    const shown: ChunkState = state === 'failed' ? 'not-yet' : state;
    const from = Math.min(1, (i * chunkSeconds) / durationSeconds);
    const to = Math.min(1, ((i + 1) * chunkSeconds) / durationSeconds);
    const last = segments[segments.length - 1];
    if (last && last.state === shown) segments[segments.length - 1] = { ...last, to };
    else if (to > from) segments.push({ from, to, state: shown });
  });
  return segments;
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/**
 * One line saying which parts of the recording a jump lands exactly in. Empty when all of it is exact, since then there is
 * nothing to say, and when no part is yet it says the first is on its way.
 */
export function exactLine(states: readonly ChunkState[], chunkSeconds: number, durationSeconds: number): string {
  if (states.length === 0 || states.every((s) => s === 'exact')) return '';
  const ranges: string[] = [];
  let start: number | null = null;
  for (let i = 0; i <= states.length; i++) {
    const exact = i < states.length && states[i] === 'exact';
    if (exact && start === null) start = i;
    if (!exact && start !== null) {
      ranges.push(`${clock(start * chunkSeconds)}–${clock(Math.min(durationSeconds, i * chunkSeconds))}`);
      start = null;
    }
  }
  if (ranges.length === 0) return 'Getting the first part of the recording exact.';
  const shown = ranges.length > 3 ? [...ranges.slice(0, 3), 'more'] : ranges;
  return `Jumps are exact in ${shown.join(', ')}. A jump anywhere else waits a moment for its part.`;
}
