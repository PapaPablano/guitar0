export interface LoopRange {
  /** Seconds of media time. */
  readonly start: number;
  readonly end: number;
  /** Midi ticks of the same range, for clocks backed by the synth. */
  readonly startTick?: number;
  readonly endTick?: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Playback rate limits shared by the clocks; a clock may raise the floor. */
export function clampRate(rate: number, min = 0.1): number {
  return clamp(rate, min, 2);
}

/** A loop needs a positive length; anything else means no loop. */
export function normalizeLoop(range: LoopRange | null): LoopRange | null {
  return range && range.end > range.start ? range : null;
}

/** What the app needs from a clock, whether it is timer-driven or backed by the synth. */
export interface Clock {
  readonly playing: boolean;
  readonly rate: number;
  readonly loop: LoopRange | null;
  /** Current media time in seconds. */
  time(): number;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setLoop(range: LoopRange | null): void;
}

/**
 * Media-time clock for the practice session. `source` returns seconds from any monotonic clock
 * (performance.now in tests and fallbacks, the Web Audio clock in the real player), so the same
 * logic runs under both. The clock holds the tempo rate and the loop range.
 */
export class PlaybackClock implements Clock {
  private anchorMedia = 0;
  private anchorSource = 0;
  private isPlaying = false;
  private currentRate = 1;
  private loopRange: LoopRange | null = null;

  constructor(
    private readonly source: () => number,
    private readonly duration: number,
  ) {}

  get playing(): boolean {
    return this.isPlaying;
  }

  get rate(): number {
    return this.currentRate;
  }

  get loop(): LoopRange | null {
    return this.loopRange;
  }

  /** Current media time in seconds. */
  time(): number {
    if (!this.isPlaying) return this.anchorMedia;
    let media = this.anchorMedia + (this.source() - this.anchorSource) * this.currentRate;
    const loop = this.loopRange;
    if (loop && media >= loop.end && this.anchorMedia < loop.end) {
      const length = loop.end - loop.start;
      media = loop.start + ((media - loop.start) % length);
      this.reanchor(media);
    }
    if (media >= this.duration) {
      this.isPlaying = false;
      this.anchorMedia = this.duration;
      return this.duration;
    }
    return Math.max(0, media);
  }

  play(): void {
    if (this.isPlaying) return;
    if (this.anchorMedia >= this.duration) this.anchorMedia = this.loopRange?.start ?? 0;
    this.anchorSource = this.source();
    this.isPlaying = true;
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.anchorMedia = this.time();
    this.isPlaying = false;
  }

  seek(seconds: number): void {
    this.anchorMedia = clamp(seconds, 0, this.duration);
    this.anchorSource = this.source();
  }

  /** Tempo as a multiple of the original; the media time advances at this rate. */
  setRate(rate: number): void {
    const current = this.time();
    this.currentRate = clampRate(rate);
    this.reanchor(current);
  }

  setLoop(range: LoopRange | null): void {
    this.loopRange = normalizeLoop(range);
  }

  private reanchor(media: number): void {
    this.anchorMedia = media;
    this.anchorSource = this.source();
  }
}
