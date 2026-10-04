import { fileTuningOptions } from './file-tuning-options';

interface FileTuningPickerProps {
  /** The track's open strings as the file wrote them. */
  written: readonly number[];
  /** The track's open strings now. */
  current: readonly number[];
  onChange: (id: string) => void;
}

/**
 * For a file whose frets are written for another tuning than it says (a song played a half step down,
 * saved as standard). Frets stay as written; the open strings, the built-in sound and the note names change.
 */
export function FileTuningPicker({ written, current, onChange }: FileTuningPickerProps) {
  const { options, value } = fileTuningOptions(written, current);
  if (options.length === 0) return null;
  return (
    <label className="field" title="Fret numbers stay as written; the open strings, the built-in sound and the note names change.">
      File is actually tuned to
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
