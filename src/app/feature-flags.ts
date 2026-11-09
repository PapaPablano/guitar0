/** Set at build time by vite.config.ts: on unless VITE_ENABLE_YOUTUBE=false. Undefined outside a Vite build (e.g. tests). */
declare const __YOUTUBE_ENABLED__: boolean | undefined;

/** Whether this build shows YouTube search and import. Off unless the build defines it as exactly true. */
export function readYoutubeFlag(defined: unknown = typeof __YOUTUBE_ENABLED__ === 'undefined' ? undefined : __YOUTUBE_ENABLED__): boolean {
  return defined === true;
}
