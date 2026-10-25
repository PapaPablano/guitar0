import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  loadLayout,
  needsBarStrip,
  normaliseLayout,
  PANEL_IDS,
  PANEL_NAMES,
  panelsOf,
  saveLayout,
  setPanel,
  showsDots,
  setBottomTrack,
  swapPanels,
  trackForSlot,
} from '../../src/app/stage-layout';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('setPanel', () => {
  it('replaces a slot', () => {
    expect(setPanel({ top: 'highway', bottom: 'tab' }, 'bottom', 'neck')).toEqual({ top: 'highway', bottom: 'neck' });
  });

  it('swaps when the other slot already shows the choice, so a panel is never on twice', () => {
    expect(setPanel({ top: 'highway', bottom: 'tab' }, 'top', 'tab')).toEqual({ top: 'tab', bottom: 'highway' });
    expect(setPanel({ top: 'highway', bottom: 'tab' }, 'bottom', 'highway')).toEqual({ top: 'tab', bottom: 'highway' });
  });

  it('lets the bottom slot be emptied but never the top', () => {
    expect(setPanel({ top: 'highway', bottom: 'tab' }, 'bottom', null)).toEqual({ top: 'highway', bottom: null });
    expect(setPanel({ top: 'highway', bottom: 'tab' }, 'top', null)).toEqual({ top: 'highway', bottom: 'tab' });
  });

  it('ignores choosing the top panel for an empty bottom slot, so a panel is never on twice', () => {
    expect(setPanel({ top: 'highway', bottom: null }, 'bottom', 'highway')).toEqual({ top: 'highway', bottom: null });
  });

  it('can fill an empty bottom slot', () => {
    expect(setPanel({ top: 'neck', bottom: null }, 'bottom', 'tab')).toEqual({ top: 'neck', bottom: 'tab' });
  });

  it('makes every pair of the four panels reachable without a repeat', () => {
    for (const a of PANEL_IDS) {
      for (const b of PANEL_IDS) {
        if (a === b) continue;
        const layout = setPanel(setPanel(DEFAULT_LAYOUT, 'top', a), 'bottom', b);
        expect(layout).toEqual({ top: a, bottom: b });
      }
    }
  });
});

describe('swapPanels', () => {
  it('trades the two panels and leaves a single panel alone', () => {
    expect(swapPanels({ top: 'highway', bottom: 'neck' })).toEqual({ top: 'neck', bottom: 'highway' });
    expect(swapPanels({ top: 'tab', bottom: null })).toEqual({ top: 'tab', bottom: null });
  });
});

describe('normaliseLayout', () => {
  it('keeps a good layout and falls back to the default for anything else', () => {
    expect(normaliseLayout({ top: 'neck', bottom: 'tab' })).toEqual({ top: 'neck', bottom: 'tab' });
    expect(normaliseLayout({ top: 'neck', bottom: null })).toEqual({ top: 'neck', bottom: null });
    expect(normaliseLayout({ top: 'neck', bottom: 'neck' })).toEqual(DEFAULT_LAYOUT);
    expect(normaliseLayout({ top: 'nope', bottom: 'tab' })).toEqual(DEFAULT_LAYOUT);
    expect(normaliseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normaliseLayout('x')).toEqual(DEFAULT_LAYOUT);
  });
});

describe('needsBarStrip', () => {
  it('is true exactly when the tab strip is not shown', () => {
    expect(needsBarStrip(['highway', 'tab'])).toBe(false);
    expect(needsBarStrip(['highway', 'neck'])).toBe(true);
    expect(needsBarStrip(['fretboard'])).toBe(true);
  });
});

describe('showsDots', () => {
  it('follow the panels on show', () => {
    expect(showsDots({ top: 'highway', bottom: 'tab' })).toBe(false);
    expect(showsDots({ top: 'highway', bottom: 'neck' })).toBe(true);
    expect(panelsOf({ top: 'tab', bottom: null })).toEqual(['tab']);
  });
});

describe('every panel has a name', () => {
  it('for the picker and the full-screen button', () => {
    for (const id of PANEL_IDS) expect(PANEL_NAMES[id].length).toBeGreaterThan(0);
  });
});

describe('saving the layout', () => {
  it('round-trips, and a bad or missing value gives the default', () => {
    const store = memory();
    expect(loadLayout(store)).toEqual(DEFAULT_LAYOUT);
    saveLayout({ top: 'tab', bottom: 'neck' }, store);
    expect(loadLayout(store)).toEqual({ top: 'tab', bottom: 'neck' });
    store.setItem('tab-highway.stage-layout', '{not json');
    expect(loadLayout(store)).toEqual(DEFAULT_LAYOUT);
  });
});

describe('the pick view (R22)', () => {
  it('covers AE16: can be chosen into either slot, alone or with another view, without a panel ever being on twice', () => {
    expect(setPanel({ top: 'highway', bottom: 'tab' }, 'bottom', 'pick')).toEqual({ top: 'highway', bottom: 'pick' });
    expect(setPanel({ top: 'highway', bottom: 'tab' }, 'top', 'pick')).toEqual({ top: 'pick', bottom: 'tab' });
    expect(setPanel({ top: 'neck', bottom: 'pick' }, 'top', 'pick')).toEqual({ top: 'pick', bottom: 'neck' });
    expect(normaliseLayout({ top: 'pick', bottom: null })).toEqual({ top: 'pick', bottom: null });
    expect(normaliseLayout({ top: 'pick', bottom: 'pick' })).toEqual(DEFAULT_LAYOUT);
  });

  it('is a separate view from the Real guitar view, with its own name', () => {
    expect(PANEL_IDS).toContain('neck');
    expect(PANEL_IDS).toContain('pick');
    expect(PANEL_NAMES.pick).not.toBe(PANEL_NAMES.neck);
  });

  it('treats the new view like the Real guitar view for the bar strip and the dot controls', () => {
    expect(needsBarStrip(['highway', 'pick'])).toBe(true);
    expect(showsDots({ top: 'highway', bottom: 'pick' })).toBe(true);
  });

  it('leaves a layout saved before it existed unchanged', () => {
    const store = memory();
    store.setItem('tab-highway.stage-layout', JSON.stringify({ top: 'highway', bottom: 'neck' }));
    expect(loadLayout(store)).toEqual({ top: 'highway', bottom: 'neck' });
  });
});

describe('a track for the bottom slot', () => {
  const song = (count: number, drums: number[] = []) => Array.from({ length: count }, (_, i) => ({ isPercussion: drums.includes(i) }));
  const layout = { top: 'neck', bottom: 'pick', bottomTrack: 2 } as const;

  it('follows the picker unless the bottom slot names a track the song has', () => {
    expect(trackForSlot({ top: 'neck', bottom: 'pick' }, 'bottom', 1, song(3))).toBe(1);
    expect(trackForSlot(layout, 'bottom', 1, song(3))).toBe(2);
    expect(trackForSlot(layout, 'top', 1, song(3))).toBe(1);
  });

  it('covers AE3: falls back to the picker when the song has no such track', () => {
    expect(trackForSlot(layout, 'bottom', 0, song(2))).toBe(0);
  });

  it('never draws a drum track as the bottom slot own track', () => {
    expect(trackForSlot(layout, 'bottom', 1, song(3, [2]))).toBe(1);
  });

  it('is read from an old layout without the field, and bad values are dropped', () => {
    expect(normaliseLayout({ top: 'neck', bottom: 'tab' })).toEqual({ top: 'neck', bottom: 'tab' });
    expect(normaliseLayout({ top: 'neck', bottom: 'tab', bottomTrack: 2 })).toEqual({ top: 'neck', bottom: 'tab', bottomTrack: 2 });
    expect(normaliseLayout({ top: 'neck', bottom: 'tab', bottomTrack: -1 })).toEqual({ top: 'neck', bottom: 'tab' });
    expect(normaliseLayout({ top: 'neck', bottom: 'tab', bottomTrack: 1.5 })).toEqual({ top: 'neck', bottom: 'tab' });
    expect(normaliseLayout({ top: 'neck', bottom: null, bottomTrack: 2 })).toEqual({ top: 'neck', bottom: null });
  });

  it('stays with the slot when views move or swap', () => {
    expect(swapPanels(layout)).toEqual({ top: 'pick', bottom: 'neck', bottomTrack: 2 });
    expect(setPanel(layout, 'top', 'pick')).toEqual({ top: 'pick', bottom: 'neck', bottomTrack: 2 });
    expect(setPanel(layout, 'bottom', 'tab')).toEqual({ top: 'neck', bottom: 'tab', bottomTrack: 2 });
  });

  it('is set and cleared, and a layout with one panel has none', () => {
    expect(setBottomTrack({ top: 'neck', bottom: 'pick' }, 3)).toEqual({ top: 'neck', bottom: 'pick', bottomTrack: 3 });
    expect(setBottomTrack(layout, undefined)).toEqual({ top: 'neck', bottom: 'pick' });
    expect(setBottomTrack({ top: 'neck', bottom: null }, 3)).toEqual({ top: 'neck', bottom: null });
    expect(setPanel(layout, 'bottom', null)).toEqual({ top: 'neck', bottom: null });
  });

  it('survives saving', () => {
    const store = memory();
    saveLayout(layout, store);
    expect(loadLayout(store)).toEqual(layout);
  });
});
