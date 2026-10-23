import type { TrackInfo } from '../model/score';

interface SlotTrackPickerProps {
  tracks: readonly TrackInfo[];
  /** The track this panel draws on its own, or undefined when it follows the track picker. */
  value: number | undefined;
  onChange: (track: number | undefined) => void;
}

/** Which track a panel draws: the picker's by default, or any playable track. Hidden when the song has only one. */
export function SlotTrackPicker({ tracks, value, onChange }: SlotTrackPickerProps) {
  const playable = tracks.filter((t) => !t.isPercussion);
  if (playable.length <= 1) return null;
  return (
    <select
      className="slot-track"
      aria-label="Track for this panel"
      title="Show a different track in this panel"
      value={value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    >
      <option value="">Same as the picker</option>
      {playable.map((t) => (
        <option key={t.index} value={t.index}>
          {t.name || `Track ${t.index + 1}`}
        </option>
      ))}
    </select>
  );
}
