import { clamp, clampRate, normalizeLoop, type Clock, type LoopRange } from './clock';
import { clampOffset } from './offset-range';

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
  /** True while the element is still moving to a position it was just given; absent on elements that do not report it. */
  readonly seeking?: boolean;
  play(): Promise<void>;
  pause(): void;
}

/** Seconds from a monotonic clock; the lead-in advances tab time from it. */
export type TimeSource = () => number;

const performanceSource: TimeSource = () => performance.now() / 1000;

/** How far the element may sit from where a loop restart should have put it before it is moved back. */
export const LANDING_TOLERANCE_SECONDS = 0.025;
/** How long after a restart the landing is first checked, one watcher tick. */
const LANDING_GRACE_SECONDS = 0.02;
/** A restart that keeps missing is corrected this many times, then left alone. */
const LANDING_MAX_CORRECTIONS = 3;

/**
 * A Clock backed by the user's own recording. Media time is the position in the tab; the recording
 * position is that time plus `offset`, so a positive offset means the recording has extra lead-in and
 * a negative one means it starts after the tab. A media element cannot sit before zero, so while the
 * recording position is negative the element waits at zero and the clock advances tab time itself
 * from `source`, then starts the element when the recording begins.
 * Tempo changes use the browser's pitch-preserving time stretch.
 */
export class UserAudioClock implements Clock {
  private offsetSeconds = 0;
  private currentRate = 1;
  private loopRange: LoopRange | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;
  /** Set while playing in the silence before the recording: tab time at `anchorSource`. */
  private leadIn: { anchorTab: number; anchorSource: number } | null = null;
  /** Tab time while paused in the silence before the recording. */
  private heldTab: number | null = null;
  private onLoopWrap: (() => void) | null = null;
  /** Where the element should be, set whenever it is positioned while playing; verified once, then cleared. */
  private landing: { target: number; at: number; corrections: number } | null = null;

  constructor(
    readonly element: AudioLike,
    private readonly duration: number,
    readonly file: File | null = null,
    private readonly objectUrl: string | null = null,
    private readonly source: TimeSource = performanceSource,
  ) {
    element.preservesPitch = true;
  }

  get playing(): boolean {
    return this.leadIn !== null || (!this.element.paused && !this.element.ended);
  }

  /** True while the clock is counting the silence before the recording and the element is not running. */
  get inLeadIn(): boolean {
    return this.leadIn !== null;
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
    if (this.leadIn) return this.leadInTime();
    if (this.heldTab !== null) return this.heldTab;
    let media = this.element.currentTime - this.offsetSeconds;
    const loop = this.loopRange;
    if (loop && this.playing && media >= loop.end) {
      media = loop.start;
      this.place(loop.start, true);
      this.onLoopWrap?.();
    }
    // A recording longer than the tab stops with the tab instead of playing on unseen.
    if (this.playing && media >= this.duration) this.element.pause();
    return clamp(media, 0, this.duration);
  }

  play(): void {
    if (this.time() >= this.duration) this.seek(this.loopRange?.start ?? 0);
    if (this.playing) {
      this.startWatcher();
      return;
    }
    this.place(this.time(), true);
    this.startWatcher();
  }

  pause(): void {
    if (this.leadIn) {
      this.heldTab = this.leadInTime();
      this.leadIn = null;
    }
    this.element.pause();
    this.landing = null;
    this.stopWatcher();
  }

  seek(seconds: number): void {
    this.place(clamp(seconds, 0, this.duration), this.playing);
  }

  setRate(rate: number): void {
    // The lead-in counts tab time at the old rate up to now, then continues at the new one.
    if (this.leadIn) this.leadIn = { anchorTab: this.leadInTime(), anchorSource: this.source() };
    if (this.landing) this.landing = { ...this.landing, target: this.expectedLanding(), at: this.source() };
    this.currentRate = clampRate(rate, 0.25);
    this.element.playbackRate = this.currentRate;
    this.element.preservesPitch = true;
  }

  setLoop(range: LoopRange | null): void {
    this.loopRange = normalizeLoop(range);
  }

  /** Called once each time playback wraps from the loop end to its start, including during the lead-in silence. */
  setLoopWrapListener(listener: (() => void) | null): void {
    this.onLoopWrap = listener;
  }

  /**
   * Moves the recording against the tab, within the shared range; the recording keeps playing from
   * where it is, so the tab time moves instead. When nothing is playing and the recording has not
   * started, there is no position to keep, so the playhead stays where it is.
   */
  setOffset(seconds: number): void {
    const next = clampOffset(seconds);
    this.landing = null;
    if (this.leadIn) {
      // Reading the lead-in can hand over to the element, so look at the state again afterwards.
      const recording = this.leadInTime() + this.offsetSeconds;
      if (this.leadIn) {
        // Still before the recording's start: keep that position, move the tab against it.
        this.offsetSeconds = next;
        this.leadIn = { anchorTab: Math.max(0, recording - next), anchorSource: this.source() };
        return;
      }
      // The element has taken over (or the tab ended): only the offset changes.
      this.offsetSeconds = next;
      return;
    }
    if (this.heldTab !== null || (this.element.paused && this.element.currentTime === 0)) {
      const tab = this.time();
      this.offsetSeconds = next;
      this.place(tab, false);
      return;
    }
    this.offsetSeconds = next;
  }

  /** Tab time during the lead-in; ends the lead-in when the recording begins or the tab ends. */
  private leadInTime(): number {
    const lead = this.leadIn!;
    let tab = lead.anchorTab + (this.source() - lead.anchorSource) * this.currentRate;
    const loop = this.loopRange;
    if (loop && tab >= loop.end) {
      this.place(loop.start, true);
      this.onLoopWrap?.();
      return loop.start;
    }
    if (tab >= this.duration) {
      this.leadIn = null;
      this.heldTab = this.duration;
      this.element.pause();
      return this.duration;
    }
    if (tab + this.offsetSeconds >= 0) {
      // Hand over to the element at the overshoot, so tab time neither jumps nor steps back.
      this.place(tab, true);
      tab = this.element.currentTime - this.offsetSeconds;
    }
    return clamp(tab, 0, this.duration);
  }

  /**
   * Puts the tab at `tab`. Before the recording starts the element waits at zero (counting the lead-in
   * when playing); otherwise the element goes to its position and runs if playback is on. The element
   * is never given a negative position.
   */
  private place(tab: number, playing: boolean): void {
    const recording = tab + this.offsetSeconds;
    if (recording < 0) {
      this.landing = null;
      if (!this.element.paused) this.element.pause();
      this.element.currentTime = 0;
      if (playing) {
        this.leadIn = { anchorTab: tab, anchorSource: this.source() };
        this.heldTab = null;
      } else {
        this.leadIn = null;
        this.heldTab = tab;
      }
      return;
    }
    this.leadIn = null;
    this.heldTab = null;
    this.element.currentTime = recording;
    this.landing = playing ? { target: recording, at: this.source(), corrections: 0 } : null;
    if (playing && this.element.paused) void this.element.play();
  }

  /** Where the element should be now, given where the last restart put it and how long it has played. */
  private expectedLanding(): number {
    const landing = this.landing!;
    return landing.target + (this.source() - landing.at) * this.currentRate;
  }

  /**
   * Checks, once the element has settled, that a restart put it where it should be, and moves it back when
   * it did not. Compressed files seek inexactly, so a pass can otherwise start on a slightly different spot.
   */
  private checkLanding(): void {
    const landing = this.landing;
    if (!landing || this.element.paused || this.element.seeking) return;
    if (this.source() - landing.at < LANDING_GRACE_SECONDS) return;
    const expected = this.expectedLanding();
    if (Math.abs(this.element.currentTime - expected) <= LANDING_TOLERANCE_SECONDS) {
      this.landing = null;
      return;
    }
    if (landing.corrections >= LANDING_MAX_CORRECTIONS) {
      this.landing = null;
      return;
    }
    this.element.currentTime = expected;
    this.landing = { target: expected, at: this.source(), corrections: landing.corrections + 1 };
  }

  /** Loop wrapping and the stop at the tab end are checked on a timer too, so they hold when frames are throttled. */
  private startWatcher(): void {
    if (this.watcher) return;
    this.watcher = setInterval(() => {
      this.time();
      this.checkLanding();
      if (!this.playing) this.stopWatcher();
    }, 20);
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
  }

  dispose(): void {
    this.stopWatcher();
    this.leadIn = null;
    this.landing = null;
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
