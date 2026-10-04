import { useRef } from 'react';
import { OFFSET_MAX_SECONDS, OFFSET_MIN_SECONDS } from '../audio/offset-range';
import { nudgeOffset, offsetControlsVisible, offsetDirectionLabel } from './offset-controls';

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
  const loaded = offsetSeconds !== null && offsetControlsVisible({ hasRecording: true });

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
            <button type="button" onClick={() => onOffsetChange(nudgeOffset(offsetSeconds, 'coarse', -1))} aria-label="Recording 100 ms later">
              -100 ms
            </button>
            <button type="button" onClick={() => onOffsetChange(nudgeOffset(offsetSeconds, 'fine', -1))} aria-label="Recording 10 ms later">
              -10 ms
            </button>
            <button type="button" onClick={() => onOffsetChange(nudgeOffset(offsetSeconds, 'fine', 1))} aria-label="Recording 10 ms earlier">
              +10 ms
            </button>
            <button type="button" onClick={() => onOffsetChange(nudgeOffset(offsetSeconds, 'coarse', 1))} aria-label="Recording 100 ms earlier">
              +100 ms
            </button>
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
