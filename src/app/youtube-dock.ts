/** Which source is heard while a video is attached: the video's own audio, or the app's synth. */
export type AudioSource = 'original' | 'synth';

export interface DockRules {
  /** Whether the player may minimize or hide the video; never while its audio is playing (R8). */
  canMinimize: boolean;
  /** Whether a full-screen panel may take the whole screen from the browser, which would hide the video. */
  panelMayUseBrowserFullscreen: boolean;
}

/** What the video's dock allows, given what is playing. With no video attached nothing is restricted. */
export function dockRules(attached: boolean, source: AudioSource): DockRules {
  const mustStayVisible = attached && source === 'original';
  return { canMinimize: !mustStayVisible, panelMayUseBrowserFullscreen: !mustStayVisible };
}

/** Smallest the video's frame may be, in CSS pixels, so the embed meets YouTube's minimum player size (200 by 200). */
export const DOCK_WIDTH_PX = 360;
export const DOCK_HEIGHT_PX = 203;
