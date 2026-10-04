interface TransportProps {
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
  playing,
  tempoPercent,
  seconds,
  durationSeconds,
  onTogglePlay,
  onRestart,
  onTempoChange,
  onSeek,
}: TransportProps) {
  return (
    <div className="transport" role="group" aria-label="Transport">
      <button type="button" onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" onClick={onRestart} aria-label="Restart from the beginning">
        Restart
      </button>
      <input
        className="seek"
        type="range"
        min={0}
        max={Math.max(0.01, durationSeconds)}
        step={0.01}
        value={Math.min(seconds, durationSeconds)}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Position"
      />
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
          aria-label="Tempo percent"
        />
      </label>
    </div>
  );
}
