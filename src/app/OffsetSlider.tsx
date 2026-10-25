import { useRef } from 'react';
import { OFFSET_MAX_SECONDS, OFFSET_MIN_SECONDS } from '../audio/offset-range';
import { NUDGES, nudgeOffset, offsetDirectionLabel } from './offset-controls';

interface OffsetSliderProps {
  /** Null when no recording is loaded. */
  offsetSeconds: number | null;
  /** The offset is the only manual timing control, shown only while no timeline is committed. */
  offsetControl: boolean;
  /** True for a YouTube take the app lined up itself, where the control only fine-tunes. */
  autoPlaced?: boolean;
  fileName: string | null;
  error: string | null;
  onLoad: (file: File) => void;
  onOffsetChange: (seconds: number) => void;
  onRemove: () => void;
}

export function OffsetSlider({ offsetSeconds, offsetControl, autoPlaced = false, fileName, error, onLoad, onOffsetChange, onRemove }: OffsetSliderProps) {
  const input = useRef<HTMLInputElement>(null);
  // The controls show for a loaded recording and for the stems; the note below says which one they move.
  const loaded = offsetSeconds !== null;

  return (
    <div className="audio-sync" role="group" aria-label="Your recording">
      <button type="button" onClick={() => input.current?.click()}>
        {loaded ? 'Replace recording' : 'Load your recording'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoad(file);
          e.target.value = '';
        }}
      />
      {loaded && (
        <>
          <span className="muted">{fileName}</span>
          {offsetControl && (
            <>
              <label className="field">
                Offset {offsetSeconds.toFixed(2)} s ({offsetDirectionLabel(offsetSeconds)})
                <input
                  type="range"
                  min={OFFSET_MIN_SECONDS}
                  max={OFFSET_MAX_SECONDS}
                  step={0.01}
                  value={offsetSeconds}
                  onChange={(e) => onOffsetChange(Number(e.target.value))}
                  aria-label="Recording offset in seconds"
                />
              </label>
              <span className="nudge" role="group" aria-label="Nudge offset">
                {NUDGES.map(([text, size, direction, label]) => (
                  <button key={text} type="button" onClick={() => onOffsetChange(nudgeOffset(offsetSeconds, size, direction))} aria-label={`Recording ${label}`}>
                    {text}
                  </button>
                ))}
              </span>
            </>
          )}
          <button type="button" onClick={onRemove}>
            Use built-in sound
          </button>
          {offsetControl && (
            <p className="muted note">
              {autoPlaced
                ? 'This take was lined up with the tab automatically. Nudge it only to fine-tune.'
                : 'The recording could not be lined up automatically, so this offset moves the whole recording against the tab. A recording that speeds up or slows down against the tab will still drift.'}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
