/** Set at build time by vite.config.ts: on unless VITE_ENABLE_YOUTUBE=false. Undefined outside a Vite build (e.g. tests). */
declare const __YOUTUBE_ENABLED__: boolean | undefined;

/** Whether this build shows YouTube search and import. Off unless the build defines it as exactly true. */
export function readYoutubeFlag(defined: unknown = typeof __YOUTUBE_ENABLED__ === 'undefined' ? undefined : __YOUTUBE_ENABLED__): boolean {
  return defined === true;
}

export interface YoutubeControls {
  /** The search input and its button. Shown whenever the option is on; usable only once the engine is ready. */
  search: boolean;
  /** Whether the search can be used now (the stem engine is ready). */
  searchUsable: boolean;
  /** The search results list with its import buttons. */
  results: boolean;
}

/** Which YouTube controls the stem panel shows. Nothing when the flag is off, whatever is saved. */
export function youtubeControls(input: { enabled: boolean; stemsEnabled: boolean; hasResults: boolean }): YoutubeControls {
  if (!input.enabled) return { search: false, searchUsable: false, results: false };
  return { search: true, searchUsable: input.stemsEnabled, results: input.hasResults };
}
