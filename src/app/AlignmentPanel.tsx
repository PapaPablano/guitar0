import { statusText } from './alignment-controls';
import { describeLandings, type LandingStats } from './landing-stats';
import type { AlignStatus } from './auto-align';

interface AlignmentPanelProps {
  status: AlignStatus;
  /** False when there is no recording file to analyse or an analysis is already running. */
  canReanalyse: boolean;
  onReanalyse: () => void;
  /** What the latest detection changed against the saved timeline, such as "38 bars re-pinned"; null when nothing is worth saying. */
  change?: string | null;
  onDismissChange?: () => void;
  /** How jumps have landed this session, before and after the exact copy was in use. */
  landingStats?: LandingStats;
}

/** What the app found when it lined the recording up with the tab. Nothing here needs correcting by hand. */
export function AlignmentPanel({ status, canReanalyse, onReanalyse, change, onDismissChange, landingStats }: AlignmentPanelProps) {
  const text = statusText(status);
  const landings = landingStats ? describeLandings(landingStats) : [];
  return (
    <div className="alignment" role="group" aria-label="Alignment with the tab">
      {text && (
        <p className="muted note" role="status">
          {text}
        </p>
      )}
      {change && (
        <p className="muted note" role="status">
          Detected again: {change}.{' '}
          <button type="button" onClick={onDismissChange}>
            Dismiss
          </button>
        </p>
      )}
      {landings.length > 0 && (
        <p className="muted note" role="status">
          {landings.join(' ')}
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
