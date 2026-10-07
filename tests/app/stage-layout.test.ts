import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  exportBottomView,
  loadLayout,
  needsBarStrip,
  normaliseLayout,
  PANEL_IDS,
  PANEL_NAMES,
  panelsOf,
  saveLayout,
  setPanel,
  showsDots,
  swapPanels,
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

describe('showsDots and exportBottomView', () => {
  it('follow the panels on show', () => {
    expect(showsDots({ top: 'highway', bottom: 'tab' })).toBe(false);
    expect(showsDots({ top: 'highway', bottom: 'neck' })).toBe(true);
    expect(exportBottomView({ top: 'highway', bottom: 'fretboard' })).toBe('fretboard');
    expect(exportBottomView({ top: 'fretboard', bottom: 'tab' })).toBe('tab');
    expect(exportBottomView({ top: 'highway', bottom: 'neck' })).toBe('tab');
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
