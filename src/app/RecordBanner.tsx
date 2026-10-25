import { openExportFolder } from '../export/save-export';
import type { RecordState } from './useRecordWithVideo';

interface RecordBannerProps {
  state: RecordState;
  onStop: () => void;
  onDismiss: () => void;
  /** Record anyway, from a warning. */
  onProceed: () => void;
  /** Plays back the captured test sound. */
  onHear: () => void;
}

function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Where a "Record with video" export stands: the setup check, then recording with a stop button, then where the file went. Top left, clear of the video dock. */
export function RecordBanner({ state, onStop, onDismiss, onProceed, onHear }: RecordBannerProps) {
  if (state.name === 'idle') return null;
  return (
    <div className={state.name === 'report' ? 'record-banner check' : 'record-banner'} role="status" aria-live="polite">
      {state.name === 'picking' && (
        <>
          Choose this tab in the picker and tick "Share tab audio".
          <button type="button" onClick={onStop}>Cancel</button>
        </>
      )}
      {state.name === 'checking' && (
        <>
          Checking the sound. A short test sound is about to play; please leave the volume and the tab alone.
          <button type="button" onClick={onStop}>Stop</button>
        </>
      )}
      {state.name === 'report' && (
        <>
          <strong>{state.result.outcome === 'clean' ? 'The sound came through cleanly.' : 'The recording may not sound like the video.'}</strong>
          <ul>
            {state.result.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <span className="record-actions">
            {state.variant === 'before-recording' && (
              <button type="button" autoFocus onClick={onProceed}>Record anyway</button>
            )}
            {state.canHear && (
              <button type="button" onClick={onHear}>Hear it yourself</button>
            )}
            <button type="button" autoFocus={state.variant === 'check-only'} onClick={onDismiss}>
              Close
            </button>
          </span>
          {state.variant === 'before-recording' && <span className="muted">To fix the share, close this and press Record with video again.</span>}
        </>
      )}
      {state.name === 'recording' && (
        <>
          <span className="record-dot" aria-hidden="true" /> Recording {clockText(state.seconds)} / {clockText(state.total)}
          <button type="button" onClick={onStop}>Stop and save</button>
        </>
      )}
      {state.name === 'saving' && <>Saving the recording…</>}
      {state.name === 'done' && (
        <>
          {state.saved.where === 'folder' ? (
            <>
              Saved {state.saved.fileName} in your Videos folder, under Tab Highway.{' '}
              <button type="button" onClick={() => void openExportFolder().catch(() => undefined)}>Open folder</button>
            </>
          ) : (
            <>Done. Your download should have started.{state.saved.reason ? ` It could not be saved to the Tab Highway folder: ${state.saved.reason}` : ''}</>
          )}
          <button type="button" onClick={onDismiss}>Close</button>
        </>
      )}
      {state.name === 'failed' && (
        <>
          The recording failed: {state.reason}
          <button type="button" onClick={onDismiss}>Close</button>
        </>
      )}
    </div>
  );
}
