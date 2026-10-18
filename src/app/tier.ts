import { createContext, useContext } from 'react';
import { getShell, invokeShell } from './desktop';
import type { PanelId, StageLayout } from './stage-layout';
import type { ToolId } from './practice-tools';

/** Free or Pro, as the desktop shell reports it. The web build is always Free. */
export type Tier = 'free' | 'pro';

export interface TierState {
  readonly tier: Tier;
  /** The shell wants a fresh status from the backend. */
  readonly needsRefresh: boolean;
  /** The remote switch for YouTube import; only meaningful for Pro. */
  readonly youtube: boolean;
  /** Unix seconds at which the current Pro status stops working, when there is one. */
  readonly validUntil: number | null;
  /** Why the tier is Free, for wording and support. */
  readonly reason: string | null;
  readonly deviceId: string | null;
}

export const FREE: TierState = { tier: 'free', needsRefresh: false, youtube: false, validUntil: null, reason: null, deviceId: null };

/** The features Pro unlocks, named the way the upgrade prompt names them. */
export type ProFeature = 'tempo' | 'real-guitar-views' | 'practice-tools' | 'stems' | 'clean-export';

export const FEATURE_NAMES: Record<ProFeature, string> = {
  tempo: 'Changing the tempo',
  'real-guitar-views': 'The real guitar and pick views',
  'practice-tools': 'Sections, backing track and alignment',
  stems: 'Stem separation',
  'clean-export': 'Exports without a watermark',
};

export const isPro = (state: TierState): boolean => state.tier === 'pro';

/** Reads the shell's answer defensively: anything that is not clearly Pro is Free. */
export function parseTier(raw: unknown): TierState {
  if (typeof raw !== 'object' || raw === null) return FREE;
  const r = raw as Record<string, unknown>;
  return {
    tier: r.tier === 'pro' ? 'pro' : 'free',
    needsRefresh: r.needsRefresh === true,
    youtube: r.youtube === true,
    validUntil: typeof r.validUntil === 'number' ? r.validUntil : null,
    reason: typeof r.reason === 'string' ? r.reason : null,
    deviceId: typeof r.deviceId === 'string' ? r.deviceId : null,
  };
}

/** Set at build time by vite.config.ts from VITE_DEV_PRO=1: lets a browser dev session behave as Pro. Never set it for a release. */
declare const __DEV_PRO__: boolean | undefined;

export function readDevProFlag(defined: unknown = typeof __DEV_PRO__ === 'undefined' ? undefined : __DEV_PRO__): boolean {
  return defined === true;
}

const DEV_PRO: TierState = { ...FREE, tier: 'pro', youtube: true, reason: 'dev-unlock' };

/** The tier now. On the web there is no shell, so it is Free (unless a dev build says otherwise). */
export async function readTier(host: object = globalThis, devPro: boolean = readDevProFlag()): Promise<TierState> {
  if (!getShell(host)) return devPro ? DEV_PRO : FREE;
  try {
    return parseTier(await invokeShell<unknown>('entitlement_status', undefined, host));
  } catch {
    return FREE;
  }
}

/** A tempo request under a tier. Free plays at 100% only; a request for anything else is blocked and tempo stays at 100. */
export function tempoFor(requested: number, state: TierState): { percent: number; blocked: boolean } {
  if (isPro(state)) return { percent: requested, blocked: false };
  return { percent: 100, blocked: requested !== 100 };
}

/** The two views that draw the guitar photo are Pro. */
export const isProPanel = (id: PanelId): boolean => id === 'neck' || id === 'pick';

export function panelAllowed(id: PanelId, state: TierState): boolean {
  return isPro(state) || !isProPanel(id);
}

const FREE_FALLBACK_PANELS: readonly PanelId[] = ['fretboard', 'highway', 'tab'];

const firstFreePanelNot = (taken: PanelId | null): PanelId => FREE_FALLBACK_PANELS.find((p) => p !== taken) ?? 'fretboard';

/** The layout a tier may show: a Pro panel in a Free layout is swapped for a free one that is not already on the page. */
export function layoutForTier(layout: StageLayout, state: TierState): StageLayout {
  if (isPro(state)) return layout;
  const top = isProPanel(layout.top) ? firstFreePanelNot(layout.bottom) : layout.top;
  if (layout.bottom === null) return { top, bottom: null };
  const bottom = isProPanel(layout.bottom) || layout.bottom === top ? firstFreePanelNot(top) : layout.bottom;
  return { top, bottom };
}

/** Free keeps the basic loop; every other practice tool is Pro. */
export function toolsForTier(tools: readonly ToolId[], state: TierState): ToolId[] {
  return isPro(state) ? [...tools] : tools.filter((t) => t === 'loop');
}

/** YouTube import needs Pro, the build setting (checked by the caller) and the remote switch. */
export const youtubeAllowed = (state: TierState): boolean => isPro(state) && state.youtube;

export const TierContext = createContext<TierState>(FREE);

export function useTier(): TierState {
  return useContext(TierContext);
}
