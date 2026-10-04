import type { BottomView } from '../render/composite';
import { DEFAULT_LABEL_MODE, type LabelMode } from '../render/fretboard';
import { clampLookahead, DEFAULT_LOOKAHEAD, MAX_LOOKAHEAD, MIN_LOOKAHEAD } from '../render/fretboard-steps';

export type { BottomView };

export interface ViewState {
  bottomView: BottomView;
  /** How many upcoming steps the fretboard shows, 1 to 8. */
  lookahead: number;
  /** What the fretboard dots say. */
  labelMode: LabelMode;
}

/** The view a freshly opened file starts in: the tab strip, four steps ahead. */
export function initialViewState(): ViewState {
  return { bottomView: 'tab', lookahead: DEFAULT_LOOKAHEAD, labelMode: DEFAULT_LABEL_MODE };
}

interface ViewControlsProps {
  view: BottomView;
  lookahead: number;
  labelMode: LabelMode;
  onViewChange: (view: BottomView) => void;
  onLookaheadChange: (lookahead: number) => void;
  onLabelModeChange: (mode: LabelMode) => void;
}

/** The bottom-panel switch, plus the look-ahead field when the fretboard is showing. */
const LABEL_CHOICES: { mode: LabelMode; text: string }[] = [
  { mode: 'fret', text: 'Fret' },
  { mode: 'note', text: 'Note' },
  { mode: 'both', text: 'Note + fret' },
];

export function ViewControls({
  view,
  lookahead,
  labelMode,
  onViewChange,
  onLookaheadChange,
  onLabelModeChange,
}: ViewControlsProps) {
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
        <div role="group" aria-label="Dot labels" className="segmented">
          {LABEL_CHOICES.map((choice) => (
            <button
              key={choice.mode}
              type="button"
              aria-pressed={labelMode === choice.mode}
              onClick={() => onLabelModeChange(choice.mode)}
            >
              {choice.text}
            </button>
          ))}
        </div>
      )}
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
