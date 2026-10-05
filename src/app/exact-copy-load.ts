import { ExactCopyBuilder, type ExactCopyResult } from '../audio/exact-copy';
import type { AudioLike } from '../audio/user-audio';

/** The one builder for the page, so a recording reopened in the same session reuses its copy. */
const exactCopies = new ExactCopyBuilder();

/** The slice of the recording clock this needs. */
export interface CopyTarget {
  readonly element: AudioLike;
  offerElement(next: AudioLike): void;
}

type CopySource = Pick<ExactCopyBuilder, 'build'>;
type MakeElement = (url: string) => Promise<AudioLike>;

/** An audio element playing the copy, ready once its length is known. */
export function loadCopyElement(url: string): Promise<AudioLike> {
  const element = new Audio();
  element.preload = 'auto';
  element.src = url;
  return new Promise((resolve, reject) => {
    element.addEventListener('loadedmetadata', () => resolve(element), { once: true });
    element.addEventListener('error', () => reject(new Error('The exact copy could not be opened.')), { once: true });
  });
}

/**
 * Makes the exact copy of a recording in the background and offers it to the clock when ready. Loading and
 * playing never wait for it, and a copy that is skipped or fails changes nothing (R11). The returned function
 * gives up the copy: call it when the recording is replaced or removed. A copy that arrives after that is
 * released and never offered.
 */
export function startExactCopy(
  file: File,
  clock: CopyTarget,
  builder: CopySource = exactCopies,
  makeElement: MakeElement = loadCopyElement,
): () => void {
  let cancelled = false;
  let result: ExactCopyResult | null = null;

  const give = () => {
    if (result?.kind === 'copy') result.release();
    result = null;
  };

  void (async () => {
    const built = await builder.build(file, clock.element.duration);
    if (built.kind !== 'copy') return;
    result = built;
    if (cancelled) return give();
    try {
      const element = await makeElement(built.url);
      if (cancelled) return give();
      clock.offerElement(element);
    } catch {
      give();
    }
  })();

  return () => {
    cancelled = true;
    give();
  };
}
