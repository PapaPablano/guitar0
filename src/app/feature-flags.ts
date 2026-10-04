/** Set at build time by vite.config.ts from VITE_ENABLE_YOUTUBE. Undefined outside a Vite build (e.g. tests). */
declare const __YOUTUBE_ENABLED__: boolean | undefined;

/** Whether this build shows YouTube search and import. Off unless the build defines it as true. */
export function readYoutubeFlag(): boolean {
  return typeof __YOUTUBE_ENABLED__ !== 'undefined' && __YOUTUBE_ENABLED__ === true;
}

export interface YoutubeControls {
  /** The search input and its button. */
  search: boolean;
  /** The search results list with its import buttons. */
  results: boolean;
}

/** Which YouTube controls the stem panel shows. Nothing when the flag is off, whatever is saved. */
export function youtubeControls(input: { enabled: boolean; stemsEnabled: boolean; hasResults: boolean }): YoutubeControls {
  if (!input.enabled) return { search: false, results: false };
  return { search: input.stemsEnabled, results: input.hasResults };
}
