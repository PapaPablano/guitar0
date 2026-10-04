import type { TrackInfo } from '../model/score';

interface TrackPickerProps {
  tracks: readonly TrackInfo[];
  value: number;
  onChange: (index: number) => void;
}

export function TrackPicker({ tracks, value, onChange }: TrackPickerProps) {
  const playable = tracks.filter((t) => !t.isPercussion);
  if (playable.length <= 1) return null;
  return (
    <label className="field">
      Track
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {playable.map((t) => (
          <option key={t.index} value={t.index}>
            {t.name || `Track ${t.index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
