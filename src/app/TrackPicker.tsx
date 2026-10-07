import type { TrackInfo } from '../model/score';

interface TrackPickerProps {
  tracks: readonly TrackInfo[];
  value: number;
  onChange: (index: number) => void;
}

/** One button per playable track; hidden when there is only one. */
export function TrackPicker({ tracks, value, onChange }: TrackPickerProps) {
  const playable = tracks.filter((t) => !t.isPercussion);
  if (playable.length <= 1) return null;
  return (
    <div role="group" aria-label="Track" className="segmented track-tabs">
      {playable.map((t) => (
        <button key={t.index} type="button" aria-pressed={t.index === value} onClick={() => onChange(t.index)}>
          {t.name || `Track ${t.index + 1}`}
        </button>
      ))}
    </div>
  );
}
