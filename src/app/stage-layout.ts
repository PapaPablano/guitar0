import { defaultProfileStorage, type ProfileStorage } from '../audio/profile-store-web';

/** The views the main page can show, two at a time. */
export type PanelId = 'highway' | 'tab' | 'fretboard' | 'neck';

export const PANEL_IDS: readonly PanelId[] = ['highway', 'tab', 'fretboard', 'neck'];

export const PANEL_NAMES: Record<PanelId, string> = {
  highway: 'Highway',
  tab: 'Tab strip',
  fretboard: 'Fretboard',
  neck: 'Real guitar',
};

/** What is on the page: a top panel, and a bottom one unless the top fills the page alone. */
export interface StageLayout {
  readonly top: PanelId;
  readonly bottom: PanelId | null;
}

export const DEFAULT_LAYOUT: StageLayout = { top: 'highway', bottom: 'tab' };

/** One-click pairs. */
export const LAYOUT_PRESETS: readonly { name: string; layout: StageLayout }[] = [
  { name: 'Highway + Tab', layout: { top: 'highway', bottom: 'tab' } },
  { name: 'Highway + Real guitar', layout: { top: 'highway', bottom: 'neck' } },
  { name: 'Tab + Real guitar', layout: { top: 'tab', bottom: 'neck' } },
];

function isPanel(value: unknown): value is PanelId {
  return typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value);
}

/** A layout from anything stored: unknown ids, or the same panel twice, give the default. */
export function normaliseLayout(raw: unknown): StageLayout {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_LAYOUT;
  const { top, bottom } = raw as { top?: unknown; bottom?: unknown };
  if (!isPanel(top)) return DEFAULT_LAYOUT;
  if (bottom === null) return { top, bottom: null };
  if (!isPanel(bottom) || bottom === top) return DEFAULT_LAYOUT;
  return { top, bottom };
}

/** Puts `id` in a slot. Choosing the panel the other slot shows swaps them, so a panel is never on twice. */
export function setPanel(layout: StageLayout, slot: 'top' | 'bottom', id: PanelId | null): StageLayout {
  if (slot === 'top') {
    if (id === null) return layout;
    return id === layout.bottom ? { top: id, bottom: layout.top } : { top: id, bottom: layout.bottom };
  }
  if (id === null) return { top: layout.top, bottom: null };
  return id === layout.top ? { top: layout.bottom ?? DEFAULT_LAYOUT.top, bottom: id } : { top: layout.top, bottom: id };
}

export function swapPanels(layout: StageLayout): StageLayout {
  return layout.bottom === null ? layout : { top: layout.bottom, bottom: layout.top };
}

export function panelsOf(layout: StageLayout): PanelId[] {
  return layout.bottom === null ? [layout.top] : [layout.top, layout.bottom];
}

/** True when neither panel is the tab strip, so seeking and looping need the slim bar strip. */
export function needsBarStrip(panels: readonly PanelId[]): boolean {
  return !panels.includes('tab');
}

/** Whether the label and look-ahead controls apply: the fretboard and the real guitar both show dots. */
export function showsDots(layout: StageLayout): boolean {
  return panelsOf(layout).some((p) => p === 'fretboard' || p === 'neck');
}

/** The video export's bottom view for a layout: the fretboard when it is shown without the tab strip. */
export function exportBottomView(layout: StageLayout): 'tab' | 'fretboard' {
  const panels = panelsOf(layout);
  return panels.includes('fretboard') && !panels.includes('tab') ? 'fretboard' : 'tab';
}

export const LAYOUT_KEY = 'tab-highway.stage-layout';

export function loadLayout(storage: ProfileStorage | null = defaultProfileStorage()): StageLayout {
  try {
    const raw = storage?.getItem(LAYOUT_KEY);
    return raw ? normaliseLayout(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/** Remembers the layout; a store that cannot be written to only means it is not kept. */
export function saveLayout(layout: StageLayout, storage: ProfileStorage | null = defaultProfileStorage()): void {
  try {
    storage?.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // not kept
  }
}
