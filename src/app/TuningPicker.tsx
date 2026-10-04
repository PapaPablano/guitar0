import { FILE_TUNING, presetsForTrack } from '../model/retune';
import type { TrackInfo } from '../model/score';

interface TuningPickerProps {
  track: TrackInfo | undefined;
  value: string;
  onChange: (id: string) => void;
}

/** Shows the track in another tuning: same sound, frets moved to fit. Hidden when there is nothing to choose. */
export function TuningPicker({ track, value, onChange }: TuningPickerProps) {
  const presets = presetsForTrack(track);
  if (presets.length === 0) return null;
  return (
    <label className="field">
      Show in tuning
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={FILE_TUNING}>File's tuning</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
