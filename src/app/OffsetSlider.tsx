import { useRef } from 'react';

interface OffsetSliderProps {
  /** Null when no recording is loaded. */
  offsetSeconds: number | null;
  fileName: string | null;
  error: string | null;
  onLoad: (file: File) => void;
  onOffsetChange: (seconds: number) => void;
  onRemove: () => void;
}

const RANGE_SECONDS = 10;

export function OffsetSlider({ offsetSeconds, fileName, error, onLoad, onOffsetChange, onRemove }: OffsetSliderProps) {
  const input = useRef<HTMLInputElement>(null);
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
            Offset {offsetSeconds.toFixed(2)} s
            <input
              type="range"
              min={-RANGE_SECONDS}
              max={RANGE_SECONDS}
              step={0.01}
              value={offsetSeconds}
              onChange={(e) => onOffsetChange(Number(e.target.value))}
              aria-label="Recording offset in seconds"
            />
          </label>
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
