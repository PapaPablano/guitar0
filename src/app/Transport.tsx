import { seekMarks, type SeekMarksInput } from './transport-marks';

interface TransportProps {
  /** Section labels and the loop band to show along the seek bar. */
  marks?: Pick<SeekMarksInput, 'sections' | 'loop'>;
  /** True until the sound is ready: playback controls are inactive. */
  disabled: boolean;
  playing: boolean;
  /** Tempo as a percentage of the original. */
  tempoPercent: number;
  seconds: number;
  durationSeconds: number;
  onTogglePlay: () => void;
  onRestart: () => void;
  onTempoChange: (percent: number) => void;
  onSeek: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function Transport({
  disabled,
  playing,
  tempoPercent,
  seconds,
  durationSeconds,
  onTogglePlay,
  onRestart,
  onTempoChange,
  onSeek,
  marks,
}: TransportProps) {
  const along = seekMarks({ durationSeconds, sections: marks?.sections ?? [], loop: marks?.loop ?? null });
  return (
    <div className="transport" role="group" aria-label="Transport">
      <button type="button" onClick={onTogglePlay} disabled={disabled} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={onRestart} disabled={disabled} aria-label="Restart from the beginning">
        Restart
      </button>
      <div className="seek-wrap">
        {along.sections.map((m) => (
          <span key={`${m.label}-${m.left}`} className="seek-mark" style={{ left: `${m.left}%` }}>
            {m.label}
          </span>
        ))}
        {along.loop && <span className="seek-loop" style={{ left: `${along.loop.left}%`, width: `${along.loop.width}%` }} aria-hidden="true" />}
        <input
          className="seek"
          type="range"
          min={0}
          max={Math.max(0.01, durationSeconds)}
          step={0.01}
          value={Math.min(seconds, durationSeconds)}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={disabled}
          aria-label="Position"
        />
      </div>
      <span className="time" aria-hidden="true">
        {formatTime(seconds)} / {formatTime(durationSeconds)}
      </span>
      <label className="field">
        Tempo {tempoPercent}%
        <input
          type="range"
          min={25}
          max={125}
          step={5}
          value={tempoPercent}
          onChange={(e) => onTempoChange(Number(e.target.value))}
          disabled={disabled}
          aria-label="Tempo percent"
        />
      </label>
    </div>
  );
}
