import { clamp, clampRate, normalizeLoop, type Clock, type LoopRange } from './clock';

/** Largest recording the page will accept. The file is streamed, not decoded, but export reads it whole. */
export const MAX_AUDIO_BYTES = 400 * 1024 * 1024;

/** The slice of HTMLAudioElement the clock uses, so tests can pass a fake. */
export interface AudioLike {
  currentTime: number;
  playbackRate: number;
  preservesPitch: boolean;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly duration: number;
  play(): Promise<void>;
  pause(): void;
}

/**
 * A Clock backed by the user's own recording. Media time is the position in the tab; the recording
 * position is that time plus `offset`, so a positive offset means the recording has extra lead-in.
 * Tempo changes use the browser's pitch-preserving time stretch.
 */
export class UserAudioClock implements Clock {
  private offsetSeconds = 0;
  private currentRate = 1;
  private loopRange: LoopRange | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly element: AudioLike,
    private readonly duration: number,
    readonly file: File | null = null,
    private readonly objectUrl: string | null = null,
  ) {
    element.preservesPitch = true;
  }

  get playing(): boolean {
    return !this.element.paused && !this.element.ended;
  }

  get rate(): number {
    return this.currentRate;
  }

  get loop(): LoopRange | null {
    return this.loopRange;
  }

  get offset(): number {
    return this.offsetSeconds;
  }

  time(): number {
    let media = this.element.currentTime - this.offsetSeconds;
    const loop = this.loopRange;
    if (loop && this.playing && media >= loop.end) {
      media = loop.start;
      this.element.currentTime = loop.start + this.offsetSeconds;
    }
    // A recording longer than the tab stops with the tab instead of playing on unseen.
    if (this.playing && media >= this.duration) this.element.pause();
    return clamp(media, 0, this.duration);
  }

  play(): void {
    if (this.time() >= this.duration) this.seek(this.loopRange?.start ?? 0);
    void this.element.play();
    this.startWatcher();
  }

  pause(): void {
    this.element.pause();
    this.stopWatcher();
  }

  seek(seconds: number): void {
    const media = clamp(seconds, 0, this.duration);
    this.element.currentTime = Math.max(0, media + this.offsetSeconds);
  }

  setRate(rate: number): void {
    this.currentRate = clampRate(rate, 0.25);
    this.element.playbackRate = this.currentRate;
    this.element.preservesPitch = true;
  }

  setLoop(range: LoopRange | null): void {
    this.loopRange = normalizeLoop(range);
  }

  /**
   * Moves the recording against the tab; the recording keeps playing from where it is. Only a
   * recording that starts earlier than the tab is supported, so the offset is never negative.
   */
  setOffset(seconds: number): void {
    this.offsetSeconds = Math.max(0, seconds);
  }

  /** Loop wrapping and the stop at the tab end are checked on a timer too, so they hold when frames are throttled. */
  private startWatcher(): void {
    if (this.watcher) return;
    this.watcher = setInterval(() => {
      this.time();
      if (!this.playing) this.stopWatcher();
    }, 20);
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
  }

  dispose(): void {
    this.stopWatcher();
    this.element.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }
}

/** Loads a recording into an audio element and waits until its length is known. */
export async function loadUserAudio(file: File, tabDurationSeconds: number): Promise<UserAudioClock> {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error('That recording is too large (the limit is 400 MB).');
  }
  const url = URL.createObjectURL(file);
  const element = new Audio();
  element.preload = 'auto';
  element.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      element.addEventListener('loadedmetadata', () => resolve(), { once: true });
      element.addEventListener(
        'error',
        () => reject(new Error('This browser cannot play that audio file.')),
        { once: true },
      );
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return new UserAudioClock(element, tabDurationSeconds, file, url);
}
