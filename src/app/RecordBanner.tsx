import { openExportFolder } from '../export/save-export';
import type { RecordState } from './useRecordWithVideo';

interface RecordBannerProps {
  state: RecordState;
  onStop: () => void;
  onDismiss: () => void;
}

function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Where a "Record with video" export stands: recording with a stop button, then where the file went. Top left, clear of the video dock. */
export function RecordBanner({ state, onStop, onDismiss }: RecordBannerProps) {
  if (state.name === 'idle') return null;
  return (
    <div className="record-banner" role="status">
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
