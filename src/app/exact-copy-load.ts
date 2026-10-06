import { ExactCopy, type ExactCopyDeps, type ExactGate } from '../audio/exact-copy';
import type { OpenResult, RecordingPcm } from '../audio/recording-pcm';
import { RegionQueue } from '../audio/region-queue';
import { openSharedPcm } from '../audio/shared-pcm';
import type { AudioLike } from '../audio/user-audio';

/** How often the player's place in the recording is passed to the queue, so what is decoded next follows it. */
const FOLLOW_MS = 500;

/** The slice of the recording clock this needs. */
export interface CopyTarget {
  readonly element: AudioLike;
  offerElement(next: AudioLike): void;
  setAdoptListener?(listener: ((element: AudioLike) => void) | null): void;
  /** Where jumps ask whether the element in use can land them exactly; see `UserAudioClock.setGate`. */
  setGate?(gate: ExactGate | null): void;
  /** Says the clock's own file seeks exactly already, as a WAV does. */
  setSeekExact?(exact: boolean): void;
}

/**
 * Where a recording stands on seeking exactly. A compressed file (mp3, m4a) seeks inexactly: after a jump the element can sit up
 * to about a second from where it says, different each time. An exact copy fixes that, so the player is told whether it is on its
 * way, ready for part of the recording, ready for all of it, or not coming.
 */
export type CopyState = 'preparing' | 'partial' | 'exact' | 'failed' | 'too-long';

/** What a started copy gives the page: the store of decoded audio and the queue that fills it. */
export interface ExactSession {
  readonly pcm: RecordingPcm;
  readonly queue: RegionQueue;
}

export interface ExactCopyLoadDeps {
  open(file: File, durationSeconds: number): Promise<OpenResult>;
  copy: ExactCopyDeps;
  followMs: number;
}

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

const browserDeps: ExactCopyLoadDeps = {
  open: (file, durationSeconds) => openSharedPcm(file, durationSeconds),
  copy: { createUrl: (blob) => URL.createObjectURL(blob), revokeUrl: (url) => URL.revokeObjectURL(url), makeElement: loadCopyElement },
  followMs: FOLLOW_MS,
};

function isWav(file: File): boolean {
  return /^audio\/(x-)?wav(e)?$/i.test(file.type) || /\.wav$/i.test(file.name);
}

/**
 * Starts making the exact copy of a recording as soon as it is chosen, and offers it to the clock when there is a part of it to
 * play. Loading and playing never wait for it, and a copy that cannot be made changes nothing about playback. The decoded audio is
 * shared (see `openSharedPcm`), so analysis and export read it instead of decoding the file again. The returned function gives up
 * the copy: call it when the recording is replaced or removed.
 */
export function startExactCopy(
  file: File,
  clock: CopyTarget,
  onState: (state: CopyState) => void = () => undefined,
  deps: ExactCopyLoadDeps = browserDeps,
  onSession: (session: ExactSession | null) => void = () => undefined,
): () => void {
  let cancelled = false;
  let queue: RegionQueue | null = null;
  let copy: ExactCopy | null = null;
  let follow: ReturnType<typeof setInterval> | null = null;
  let unlisten: (() => void) | null = null;
  const report = (state: CopyState) => {
    if (!cancelled) onState(state);
  };
  report('preparing');

  // Until the decoded audio is open there is no copy to ask, so a jump in those first moments is held for it rather than landing
  // on the recording's own file; a WAV needs no copy, so it is never held.
  let resolveGate: (gate: ExactGate | null) => void = () => undefined;
  const gateReady = new Promise<ExactGate | null>((resolve) => (resolveGate = resolve));
  if (!isWav(file)) {
    clock.setGate?.({
      owns: () => false,
      covers: () => false,
      prepare: async (seconds, count) => {
        const gate = await gateReady;
        return gate ? gate.prepare(seconds, count) : false;
      },
    });
  }

  const stop = () => {
    cancelled = true;
    resolveGate(null);
    if (follow) clearInterval(follow);
    unlisten?.();
    queue?.stop();
    copy?.stop();
    clock.setGate?.(null);
    clock.setAdoptListener?.(null);
    onSession(null);
  };

  void (async () => {
    const opened = await deps.open(file, clock.element.duration);
    if (cancelled) return;
    if (opened.kind === 'not-possible') {
      // A WAV needs no copy to seek exactly, so being unable to keep its decode says nothing about seeking.
      if (isWav(file)) clock.setSeekExact?.(true);
      else clock.setGate?.(null);
      resolveGate(null);
      return report(isWav(file) ? 'exact' : opened.reason === 'too-long' ? 'too-long' : 'failed');
    }
    const pcm = opened.pcm;
    if (isWav(file)) {
      clock.setSeekExact?.(true);
      onSession({ pcm, queue: new RegionQueue(pcm) });
      return report('exact');
    }
    queue = new RegionQueue(pcm);
    copy = new ExactCopy(pcm, queue, (element) => clock.offerElement(element), deps.copy);
    clock.setAdoptListener?.((element) => copy?.adopted(element));
    clock.setGate?.(copy);
    resolveGate(copy);
    onSession({ pcm, queue });
    follow = setInterval(() => queue?.setPlayhead(clock.element.currentTime), deps.followMs);
    unlisten = pcm.onChange(() => {
      if (pcm.complete) report('exact');
    });
    const ready = await copy.prepare(clock.element.currentTime);
    if (cancelled) return;
    report(ready ? (pcm.complete ? 'exact' : 'partial') : 'failed');
  })();

  return stop;
}
