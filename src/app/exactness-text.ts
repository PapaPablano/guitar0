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
