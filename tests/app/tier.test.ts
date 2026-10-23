import { describe, expect, it, vi } from 'vitest';
import { availableTools } from '../../src/app/practice-tools';
import { DEFAULT_LAYOUT, type StageLayout } from '../../src/app/stage-layout';
import { FREE, isProPanel, layoutForTier, panelAllowed, parseTier, readDevProFlag, readTier, tempoFor, toolsForTier, youtubeAllowed, type TierState } from '../../src/app/tier';

const PRO: TierState = { ...FREE, tier: 'pro', youtube: true };

describe('parseTier', () => {
  it('reads the shell answer and treats anything unclear as Free', () => {
    expect(parseTier({ tier: 'pro', needsRefresh: true, youtube: true, validUntil: 5, reason: null, deviceId: 'd' })).toEqual({ tier: 'pro', needsRefresh: true, youtube: true, validUntil: 5, reason: null, deviceId: 'd' });
    expect(parseTier(null)).toEqual(FREE);
    expect(parseTier('pro')).toEqual(FREE);
    expect(parseTier({ tier: 'platinum' }).tier).toBe('free');
    expect(parseTier({ tier: 'pro', youtube: 'yes' }).youtube).toBe(false);
  });
});

describe('readTier', () => {
  it('is Free on the web, and Pro only for a dev build', async () => {
    expect(await readTier({}, false)).toEqual(FREE);
    expect((await readTier({}, true)).tier).toBe('pro');
    expect(readDevProFlag(true)).toBe(true);
    expect(readDevProFlag(undefined)).toBe(false);
    expect(readDevProFlag('1')).toBe(false);
  });

  it('asks the shell on desktop and falls back to Free if it fails', async () => {
    const invoke = vi.fn().mockResolvedValue({ tier: 'pro', youtube: true });
    expect((await readTier({ __TAURI__: { core: { invoke } } }, false)).tier).toBe('pro');
    expect(invoke).toHaveBeenCalledWith('entitlement_status', undefined);
    const broken = vi.fn().mockRejectedValue(new Error('no shell'));
    expect(await readTier({ __TAURI__: { core: { invoke: broken } } }, false)).toEqual(FREE);
  });
});

describe('tempo', () => {
  it('Covers AE1. Free cannot leave 100%, in either direction', () => {
    expect(tempoFor(100, FREE)).toEqual({ percent: 100, blocked: false });
    expect(tempoFor(75, FREE)).toEqual({ percent: 100, blocked: true });
    expect(tempoFor(120, FREE)).toEqual({ percent: 100, blocked: true });
  });

  it('Pro can set any tempo, and full speed is unchanged', () => {
    expect(tempoFor(60, PRO)).toEqual({ percent: 60, blocked: false });
    expect(tempoFor(100, PRO)).toEqual({ percent: 100, blocked: false });
  });
});

describe('views', () => {
  it('the real guitar and pick views are Pro', () => {
    expect(isProPanel('neck')).toBe(true);
    expect(isProPanel('pick')).toBe(true);
    expect(isProPanel('highway')).toBe(false);
    expect(panelAllowed('pick', FREE)).toBe(false);
    expect(panelAllowed('pick', PRO)).toBe(true);
    expect(panelAllowed('fretboard', FREE)).toBe(true);
  });

  it('a saved Pro layout shows free views to a Free user, without repeating a panel, and is kept for Pro', () => {
    const saved: StageLayout = { top: 'highway', bottom: 'neck' };
    expect(layoutForTier(saved, FREE)).toEqual({ top: 'highway', bottom: 'fretboard' });
    expect(layoutForTier({ top: 'pick', bottom: 'fretboard' }, FREE)).toEqual({ top: 'highway', bottom: 'fretboard' });
    // the bottom slot keeps its own track when its view is swapped for a free one
    expect(layoutForTier({ top: 'highway', bottom: 'neck', bottomTrack: 2 }, FREE)).toEqual({ top: 'highway', bottom: 'fretboard', bottomTrack: 2 });
    expect(layoutForTier({ top: 'neck', bottom: 'pick' }, FREE)).toEqual({ top: 'fretboard', bottom: 'highway' });
    expect(layoutForTier({ top: 'neck', bottom: null }, FREE)).toEqual({ top: 'fretboard', bottom: null });
    expect(layoutForTier(DEFAULT_LAYOUT, FREE)).toEqual(DEFAULT_LAYOUT);
    expect(layoutForTier(saved, PRO)).toEqual(saved);
  });
});

describe('practice tools and YouTube', () => {
  it('Free keeps only the basic loop; Pro keeps every tool', () => {
    const all = availableTools({ hasAudioSource: true, hasSections: true });
    expect(toolsForTier(all, FREE)).toEqual(['loop']);
    expect(toolsForTier(all, PRO)).toEqual(all);
  });

  it('Covers R18. YouTube needs Pro and the status switch on', () => {
    expect(youtubeAllowed(PRO)).toBe(true);
    expect(youtubeAllowed({ ...PRO, youtube: false })).toBe(false);
    expect(youtubeAllowed({ ...FREE, youtube: true })).toBe(false);
  });
});
