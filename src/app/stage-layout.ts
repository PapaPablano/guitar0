import { defaultProfileStorage, type ProfileStorage } from '../audio/profile-store-web';

/** The views the main page can show, two at a time. */
export type PanelId = 'highway' | 'tab' | 'fretboard' | 'neck' | 'pick';

export const PANEL_IDS: readonly PanelId[] = ['highway', 'tab', 'fretboard', 'neck', 'pick'];

/** The two views that draw the guitar photo with rings: the Real guitar view and the pick view. They share dots, technique cues and the neck drawing. */
export const isGuitarPanel = (p: PanelId): boolean => p === 'neck' || p === 'pick';

export const PANEL_NAMES: Record<PanelId, string> = {
  highway: 'Highway',
  tab: 'Tab strip',
  fretboard: 'Fretboard',
  neck: 'Real guitar',
  pick: 'Real guitar + pick',
};

/** What is on the page: a top panel, and a bottom one unless the top fills the page alone. */
export interface StageLayout {
  readonly top: PanelId;
  readonly bottom: PanelId | null;
  /** The track the bottom panel draws; absent means the track picked in the track picker. The top panel always follows the picker. */
  readonly bottomTrack?: number;
}

/** A layout with the bottom track set, or without the field at all when there is none, so layouts without one stay as they were. */
function withBottomTrack(top: PanelId, bottom: PanelId | null, track: number | undefined): StageLayout {
  return track === undefined || bottom === null ? { top, bottom } : { top, bottom, bottomTrack: track };
}

/** The track each shown panel draws, top first: the top follows the picker, the bottom has its own when it names a playable track the song has. */
export function trackForSlot(
  layout: StageLayout,
  slot: 'top' | 'bottom',
  pickerTrack: number,
  tracks: readonly { readonly isPercussion: boolean }[],
): number {
  if (slot === 'top') return pickerTrack;
  const own = layout.bottomTrack;
  // the chooser lists playable tracks only, so a drum track is never a panel's own
  return own !== undefined && Number.isInteger(own) && own >= 0 && own < tracks.length && !tracks[own].isPercussion ? own : pickerTrack;
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
  const { top, bottom, bottomTrack } = raw as { top?: unknown; bottom?: unknown; bottomTrack?: unknown };
  if (!isPanel(top)) return DEFAULT_LAYOUT;
  if (bottom === null) return { top, bottom: null };
  if (!isPanel(bottom) || bottom === top) return DEFAULT_LAYOUT;
  const track = typeof bottomTrack === 'number' && Number.isInteger(bottomTrack) && bottomTrack >= 0 ? bottomTrack : undefined;
  return withBottomTrack(top, bottom, track);
}

/** Puts `id` in a slot. Choosing the panel the other slot shows swaps them, so a panel is never on twice. */
export function setPanel(layout: StageLayout, slot: 'top' | 'bottom', id: PanelId | null): StageLayout {
  if (slot === 'top') {
    if (id === null) return layout;
    // a track belongs to its slot, so moving views between slots leaves each slot's track where it was
    return id === layout.bottom ? withBottomTrack(id, layout.top, layout.bottomTrack) : withBottomTrack(id, layout.bottom, layout.bottomTrack);
  }
  if (id === null) return { top: layout.top, bottom: null };
  if (id === layout.top) return layout.bottom === null ? layout : withBottomTrack(layout.bottom, id, layout.bottomTrack);
  return withBottomTrack(layout.top, id, layout.bottomTrack);
}

export function swapPanels(layout: StageLayout): StageLayout {
  return layout.bottom === null ? layout : withBottomTrack(layout.bottom, layout.top, layout.bottomTrack);
}

/** Gives the bottom panel its own track, or back to the picker's with `undefined`. */
export function setBottomTrack(layout: StageLayout, track: number | undefined): StageLayout {
  return withBottomTrack(layout.top, layout.bottom, track);
}

export function panelsOf(layout: StageLayout): PanelId[] {
  return layout.bottom === null ? [layout.top] : [layout.top, layout.bottom];
}

/** True when neither panel is the tab strip, so seeking and looping need the slim bar strip. */
export function needsBarStrip(panels: readonly PanelId[]): boolean {
  return !panels.includes('tab');
}

/** Whether the label and look-ahead controls apply: the fretboard and both real guitar views show dots. */
export function showsDots(layout: StageLayout): boolean {
  return panelsOf(layout).some((p) => p === 'fretboard' || isGuitarPanel(p));
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
