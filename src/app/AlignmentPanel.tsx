import type { AlignmentMap } from '../audio/alignment-map';
import type { Timeline } from '../model/score';
import { describeSections, nudgeSection, removeSection, statusText } from './alignment-controls';
import type { AlignStatus } from './auto-align';

/** Visible text, step size, direction and spoken label for each nudge button, in display order. */
const NUDGES = [
  ['-100 ms', 'coarse', -1, '100 ms shorter'],
  ['-10 ms', 'fine', -1, '10 ms shorter'],
  ['+10 ms', 'fine', 1, '10 ms longer'],
  ['+100 ms', 'coarse', 1, '100 ms longer'],
] as const;

interface AlignmentPanelProps {
  status: AlignStatus;
  alignment: AlignmentMap;
  timeline: Timeline;
  /** False when there is no recording file to analyse or an analysis is already running. */
  canReanalyse: boolean;
  onChange: (map: AlignmentMap) => void;
  onRevert: () => void;
  onReanalyse: () => void;
}

/** What the app found when it lined the recording up with the tab, with the controls to correct it. */
export function AlignmentPanel({ status, alignment, timeline, canReanalyse, onChange, onRevert, onReanalyse }: AlignmentPanelProps) {
  const sections = describeSections(alignment, timeline);
  const text = statusText(status);
  return (
    <div className="alignment" role="group" aria-label="Alignment with the tab">
      {text && (
        <p className="muted note" role="status">
          {text}
        </p>
      )}
      {sections.length > 0 && (
        <ul className="alignment-sections">
          {sections.map(({ index, label }) => (
            <li key={index} className="alignment-section">
              <span>{label}</span>
              <span className="nudge" role="group" aria-label={`Nudge section ${index + 1}`}>
                {NUDGES.map(([nudgeText, size, direction, spoken]) => (
                  <button
                    key={nudgeText}
                    type="button"
                    onClick={() => onChange(nudgeSection(alignment, index, size, direction))}
                    aria-label={`Extra playing ${index + 1} ${spoken}`}
                  >
                    {nudgeText}
                  </button>
                ))}
              </span>
              <button type="button" onClick={() => onChange(removeSection(alignment, index))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="alignment-actions">
        <button type="button" onClick={onReanalyse} disabled={!canReanalyse}>
          Re-analyse
        </button>
        <button type="button" onClick={onRevert} disabled={sections.length === 0}>
          Use manual offset
        </button>
      </span>
    </div>
  );
}
