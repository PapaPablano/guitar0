import { useRef } from 'react';
import { OFFSET_MAX_SECONDS, OFFSET_MIN_SECONDS } from '../audio/offset-range';
import { nudgeOffset, offsetDirectionLabel } from './offset-controls';

/** Visible text, step size, direction and spoken label for each nudge button, in display order. */
const NUDGES = [
  ['-100 ms', 'coarse', -1, '100 ms later'],
  ['-10 ms', 'fine', -1, '10 ms later'],
  ['+10 ms', 'fine', 1, '10 ms earlier'],
  ['+100 ms', 'coarse', 1, '100 ms earlier'],
] as const;

interface OffsetSliderProps {
  /** Null when no recording is loaded. */
  offsetSeconds: number | null;
  fileName: string | null;
  error: string | null;
  onLoad: (file: File) => void;
  onOffsetChange: (seconds: number) => void;
  onRemove: () => void;
}

export function OffsetSlider({ offsetSeconds, fileName, error, onLoad, onOffsetChange, onRemove }: OffsetSliderProps) {
  const input = useRef<HTMLInputElement>(null);
  // The offset controls follow the recording alone: not the desktop bridge, not stems (AE10).
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
          <button type="button" onClick={onRemove}>
            Use built-in sound
          </button>
          <p className="muted note">
            One offset aligns the whole recording, so a recording that speeds up or slows down against the tab will drift.
          </p>
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
