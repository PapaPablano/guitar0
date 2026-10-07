import { DEFAULT_LABEL_MODE, type LabelMode } from '../render/fretboard';
import { clampLookahead, DEFAULT_LOOKAHEAD, MAX_LOOKAHEAD, MIN_LOOKAHEAD } from '../render/fretboard-steps';
import { Menu } from './Menu';
import {
  LAYOUT_PRESETS,
  loadLayout,
  PANEL_IDS,
  PANEL_NAMES,
  setPanel,
  showsDots,
  swapPanels,
  type PanelId,
  type StageLayout,
} from './stage-layout';

export interface ViewState {
  layout: StageLayout;
  /** How many upcoming steps the fretboard shows, 1 to 8. */
  lookahead: number;
  /** What the fretboard dots say. */
  labelMode: LabelMode;
}

/** The view a freshly opened file starts in: the layout the player last chose (highway over the tab strip at first), four steps ahead. */
export function initialViewState(): ViewState {
  return { layout: loadLayout(), lookahead: DEFAULT_LOOKAHEAD, labelMode: DEFAULT_LABEL_MODE };
}

interface ViewControlsProps {
  layout: StageLayout;
  lookahead: number;
  labelMode: LabelMode;
  onLayoutChange: (layout: StageLayout) => void;
  onLookaheadChange: (lookahead: number) => void;
  onLabelModeChange: (mode: LabelMode) => void;
}

const LABEL_CHOICES: { mode: LabelMode; text: string }[] = [
  { mode: 'fret', text: 'Fret' },
  { mode: 'note', text: 'Note' },
  { mode: 'both', text: 'Note + fret' },
];

function PanelSelect({ label, value, allowNone, onChange }: { label: string; value: PanelId | null; allowNone: boolean; onChange: (id: PanelId | null) => void }) {
  return (
    <label className="field">
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as PanelId))}>
        {allowNone && <option value="">None</option>}
        {PANEL_IDS.map((id) => (
          <option key={id} value={id}>
            {PANEL_NAMES[id]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Which two views are on the page, plus the dot labels and look-ahead when a view with dots is showing. */
export function ViewControls({ layout, lookahead, labelMode, onLayoutChange, onLookaheadChange, onLabelModeChange }: ViewControlsProps) {
  const dots = showsDots(layout);
  const summary = layout.bottom ? `${PANEL_NAMES[layout.top]} + ${PANEL_NAMES[layout.bottom]}` : PANEL_NAMES[layout.top];
  return (
    <div className="view-controls">
      <Menu label={<><span className="muted">Views</span> {summary}</>} className="panels-menu">
        <PanelSelect label="Top" value={layout.top} allowNone={false} onChange={(id) => onLayoutChange(setPanel(layout, 'top', id))} />
        <PanelSelect label="Bottom" value={layout.bottom} allowNone onChange={(id) => onLayoutChange(setPanel(layout, 'bottom', id))} />
        <button type="button" onClick={() => onLayoutChange(swapPanels(layout))} disabled={layout.bottom === null}>
          Swap top and bottom
        </button>
        <div role="group" aria-label="Presets" className="presets">
          {LAYOUT_PRESETS.map((p) => (
            <button key={p.name} type="button" onClick={() => onLayoutChange(p.layout)}>
              {p.name}
            </button>
          ))}
        </div>
      </Menu>
      {dots && (
        <div role="group" aria-label="Dot labels" className="segmented">
          {LABEL_CHOICES.map((choice) => (
            <button key={choice.mode} type="button" aria-pressed={labelMode === choice.mode} onClick={() => onLabelModeChange(choice.mode)}>
              {choice.text}
            </button>
          ))}
        </div>
      )}
      {dots && (
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
