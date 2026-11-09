export type BackingMethod = 'file' | 'video';

/** The ways to get a backing track: loading a file always; a YouTube video wherever the embed is allowed (web and desktop). */
export function methodsFor(flags: { video: boolean }): BackingMethod[] {
  return flags.video ? ['file', 'video'] : ['file'];
}
