import type { BottomView } from '../render/composite';
import { clampLookahead, DEFAULT_LOOKAHEAD, MAX_LOOKAHEAD, MIN_LOOKAHEAD } from '../render/fretboard-steps';

export { clampLookahead };
export type { BottomView };

export interface ViewState {
  bottomView: BottomView;
  /** How many upcoming steps the fretboard shows, 1 to 8. */
  lookahead: number;
}

/** The view a freshly opened file starts in: the tab strip, four steps ahead. */
export function initialViewState(): ViewState {
  return { bottomView: 'tab', lookahead: DEFAULT_LOOKAHEAD };
}

interface ViewControlsProps {
  view: BottomView;
  lookahead: number;
  onViewChange: (view: BottomView) => void;
  onLookaheadChange: (lookahead: number) => void;
}

/** The bottom-panel switch, plus the look-ahead field when the fretboard is showing. */
export function ViewControls({ view, lookahead, onViewChange, onLookaheadChange }: ViewControlsProps) {
  return (
    <div className="view-controls">
      <div role="group" aria-label="Bottom view" className="segmented">
        <button type="button" aria-pressed={view === 'tab'} onClick={() => onViewChange('tab')}>
          Tab strip
        </button>
        <button type="button" aria-pressed={view === 'fretboard'} onClick={() => onViewChange('fretboard')}>
          Fretboard
        </button>
      </div>
      {view === 'fretboard' && (
        <label className="field">
          Notes ahead
          <input
            type="number"
            min={MIN_LOOKAHEAD}
            max={MAX_LOOKAHEAD}
            value={lookahead}
            onChange={(e) => {
              // an emptied field keeps the previous value while the player types
              if (e.target.value === '') return;
              onLookaheadChange(clampLookahead(Number(e.target.value)));
            }}
            aria-label="Notes ahead, 1 to 8"
          />
        </label>
      )}
    </div>
  );
}
