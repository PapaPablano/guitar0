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

/**
 * Where a recording stands on seeking exactly. A compressed file (mp3, m4a) seeks inexactly: after a jump the
 * element can sit up to about a second from where it says, different each time, which throws the tab out of sync.
 * An exact copy fixes that, so the player is told whether it is on its way, in use, or not coming.
 */
export type CopyState = 'preparing' | 'exact' | 'failed' | 'too-long';

/** What to tell the player about the copy; empty when there is nothing to say. */
export function copyStateText(state: CopyState | null): string {
  switch (state) {
    case 'preparing':
      return 'Preparing an exact copy of the recording. Until it is ready, jumping around can land up to about a second off.';
    case 'failed':
      return 'An exact copy of the recording could not be made, so jumping around can land up to about a second off and throw the tab out of sync. Load a WAV version of the recording for exact jumps.';
    case 'too-long':
      return 'This recording is too long for an exact copy, so jumping around can land up to about a second off and throw the tab out of sync. Load a shorter or WAV version of the recording for exact jumps.';
    default:
      return '';
  }
}
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
  onState: (state: CopyState) => void = () => undefined,
): () => void {
  let cancelled = false;
  let result: ExactCopyResult | null = null;
  const report = (state: CopyState) => {
    if (!cancelled) onState(state);
  };
  report('preparing');

  const give = () => {
    if (result?.kind === 'copy') result.release();
    result = null;
  };

  void (async () => {
    const built = await builder.build(file, clock.element.duration);
    if (built.kind === 'skipped') return report(built.reason === 'already-wav' ? 'exact' : 'too-long');
    if (built.kind === 'failed') return report('failed');
    result = built;
    if (cancelled) return give();
    try {
      const element = await makeElement(built.url);
      if (cancelled) return give();
      clock.offerElement(element);
      report('exact');
    } catch {
      give();
      report('failed');
    }
  })();

  return () => {
    cancelled = true;
    give();
  };
}
