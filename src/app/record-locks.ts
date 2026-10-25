/** The slice of the record state the locks depend on. */
export interface RecordLockState {
  name: 'idle' | 'picking' | 'checking' | 'report' | 'recording' | 'saving' | 'done' | 'failed';
  variant?: 'before-recording' | 'check-only';
}

export interface RecordLocks {
  locked: boolean;
  /** Shown beside a disabled control, so the player is told why it is unavailable. */
  reason: string | null;
}

const REASON = 'Unavailable while a recording is being made, so nothing but the video gets into the file.';

/**
 * While a recording is being set up or running, the audio source cannot be switched and recordings or stems cannot be
 * loaded: either would start the app's own sound and put it in the file. A Re-check never records, so it locks nothing.
 */
export function recordLocks(state: RecordLockState): RecordLocks {
  const locked =
    state.name === 'picking' ||
    state.name === 'checking' ||
    state.name === 'recording' ||
    (state.name === 'report' && state.variant === 'before-recording');
  return locked ? { locked, reason: REASON } : { locked: false, reason: null };
}
