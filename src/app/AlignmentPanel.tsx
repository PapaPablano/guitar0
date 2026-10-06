import { statusText } from './alignment-controls';
import type { AlignStatus } from './auto-align';

interface AlignmentPanelProps {
  status: AlignStatus;
  /** False when there is no recording file to analyse or an analysis is already running. */
  canReanalyse: boolean;
  onReanalyse: () => void;
}

/** What the app found when it lined the recording up with the tab. Nothing here needs correcting by hand. */
export function AlignmentPanel({ status, canReanalyse, onReanalyse }: AlignmentPanelProps) {
  const text = statusText(status);
  return (
    <div className="alignment" role="group" aria-label="Alignment with the tab">
      {text && (
        <p className="muted note" role="status">
          {text}
        </p>
      )}
      <span className="alignment-actions">
        <button type="button" onClick={onReanalyse} disabled={!canReanalyse}>
          Re-analyse
        </button>
      </span>
    </div>
  );
}
