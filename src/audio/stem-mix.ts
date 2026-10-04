import type { Clock, LoopRange } from './clock';
import { stemGains, type MixState } from './mix-gains';
import { UserAudioClock, type AudioLike } from './user-audio';
import type { StemName } from '../stems/engine-client';

/** How far a follower may sit from the leader before it is pulled back. */
export const DRIFT_TOLERANCE_SECONDS = 0.04;
/** How often followers are checked; the same cadence the recording clock uses for loops. */
const RESYNC_MS = 20;

/** One stem: its audio element and the gain stage in front of the speakers. */
export interface StemChannel {
  readonly name: StemName;
  readonly element: AudioLike;
  setGain(gain: number): void;
  dispose(): void;
}

/**
 * Plays the stems together as one Clock. The first channel leads: it owns time, offset, loop and tempo
 * through a recording clock, and every other channel follows it and is pulled back when it drifts. Each
 * stem is its own media element so tempo changes keep pitch.
 */
export class StemMixClock implements Clock {
  private readonly leader: UserAudioClock;
  private readonly followers: readonly StemChannel[];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly channels: readonly StemChannel[],
    durationSeconds: number,
  ) {
    this.leader = new UserAudioClock(channels[0].element, durationSeconds);
    this.followers = channels.slice(1);
    for (const c of channels) c.element.preservesPitch = true;
  }

  get playing(): boolean {
    return this.leader.playing;
  }
  get rate(): number {
    return this.leader.rate;
  }
  get loop(): LoopRange | null {
    return this.leader.loop;
  }
  get offset(): number {
    return this.leader.offset;
  }

  time(): number {
    return this.leader.time();
  }

  play(): void {
    this.leader.play();
    this.resync();
    for (const f of this.followers) void f.element.play();
    this.startTimer();
  }

  pause(): void {
    this.leader.pause();
    for (const f of this.followers) f.element.pause();
    this.stopTimer();
  }

  seek(seconds: number): void {
    this.leader.seek(seconds);
    this.resync(0);
  }

  setRate(rate: number): void {
    this.leader.setRate(rate);
    for (const f of this.followers) {
      f.element.playbackRate = this.leader.rate;
      f.element.preservesPitch = true;
    }
  }

  setLoop(range: LoopRange | null): void {
    this.leader.setLoop(range);
  }

  /** The recording moves against the tab; every stem keeps playing from where it is. */
  setOffset(seconds: number): void {
    this.leader.setOffset(seconds);
  }

  setMix(mix: MixState): void {
    const gains = stemGains(mix);
    for (const c of this.channels) c.setGain(gains[c.name]);
  }

  /** Pulls followers that sit further than the tolerance from the leader back to it. */
  resync(tolerance = DRIFT_TOLERANCE_SECONDS): void {
    const target = this.channels[0].element.currentTime;
    for (const f of this.followers) {
      if (Math.abs(f.element.currentTime - target) > tolerance) f.element.currentTime = target;
    }
  }

  dispose(): void {
    this.stopTimer();
    this.leader.dispose();
    for (const c of this.channels) c.dispose();
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.time();
      this.resync();
      if (!this.playing) {
        for (const f of this.followers) f.element.pause();
        this.stopTimer();
      }
    }, RESYNC_MS);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** A stem backed by a real audio element routed through a gain node. */
export function createWebAudioChannel(context: AudioContext, name: StemName, url: string): Promise<StemChannel> {
  const element = new Audio();
  element.preload = 'auto';
  element.src = url;
  return new Promise((resolve, reject) => {
    element.addEventListener(
      'loadedmetadata',
      () => {
        const gain = context.createGain();
        context.createMediaElementSource(element).connect(gain);
        gain.connect(context.destination);
        resolve({
          name,
          element,
          setGain: (g) => {
            gain.gain.value = g;
          },
          dispose: () => {
            element.pause();
            gain.disconnect();
            URL.revokeObjectURL(url);
          },
        });
      },
      { once: true },
    );
    element.addEventListener('error', () => reject(new Error(`The ${name} stem could not be loaded.`)), { once: true });
  });
}
