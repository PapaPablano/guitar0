import type { AlignmentMap } from './alignment-map';
import type { Clock, LoopRange } from './clock';
import { stemGains, initialMix, type MixState } from './mix-gains';
import { passMix, type PassSchedule } from './pass-schedule';
import { UserAudioClock, type AudioLike, type LandingReport, type TimeSource } from './user-audio';
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
 * stem is its own media element so tempo changes keep pitch. While the leader counts the silence before a
 * recording that starts after the tab, the followers wait and are not resynced.
 */
export class StemMixClock implements Clock {
  private readonly leader: UserAudioClock;
  private readonly followers: readonly StemChannel[];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The user's own mix; a pass schedule is applied on top of it and it comes back when the schedule ends. */
  private baseMix: MixState = initialMix();
  private schedule: PassSchedule = { kind: 'off' };
  private passNumber = 1;
  private readonly passListeners = new Set<() => void>();

  constructor(
    private readonly channels: readonly StemChannel[],
    durationSeconds: number,
    source?: TimeSource,
  ) {
    this.leader = new UserAudioClock(channels[0].element, durationSeconds, null, null, source);
    this.followers = channels.slice(1);
    for (const c of channels) c.element.preservesPitch = true;
    this.leader.setLoopWrapListener(() => {
      // The leader has just restarted: put every follower on the same spot now, not on the next tick.
      this.resync(0);
      this.passNumber += 1;
      this.applyMix();
      this.notifyPass();
    });
  }

  /** The 1-based pass of the loop in progress. */
  get pass(): number {
    return this.passNumber;
  }

  /** Calls `listener` whenever the pass number changes; returns a function that stops it. */
  onPassChange(listener: () => void): () => void {
    this.passListeners.add(listener);
    return () => this.passListeners.delete(listener);
  }

  /** Chooses how the mix changes per loop pass; starts again from pass 1. "off" restores the base mix. */
  setSchedule(schedule: PassSchedule): void {
    this.schedule = schedule;
    this.resetPass();
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
  get alignment(): AlignmentMap {
    return this.leader.alignment;
  }

  time(): number {
    return this.leader.time();
  }

  play(): void {
    this.leader.play();
    this.followLeader();
    this.startTimer();
  }

  pause(): void {
    this.leader.pause();
    for (const f of this.followers) f.element.pause();
    this.stopTimer();
  }

  seek(seconds: number): void {
    this.leader.seek(seconds);
    if (this.leader.inLeadIn) {
      for (const f of this.followers) {
        f.element.pause();
        f.element.currentTime = 0;
      }
      return;
    }
    this.resync(0);
    this.followLeader();
  }

  setRate(rate: number): void {
    this.leader.setRate(rate);
    for (const f of this.followers) {
      f.element.playbackRate = this.leader.rate;
      f.element.preservesPitch = true;
    }
  }

  setLoop(range: LoopRange | null): void {
    const before = this.leader.loop;
    this.leader.setLoop(range);
    const after = this.leader.loop;
    if (before?.start !== after?.start || before?.end !== after?.end) this.resetPass();
  }

  /** The recording moves against the tab; every stem keeps playing from where it is. */
  setOffset(seconds: number): void {
    this.leader.setOffset(seconds);
  }

  /** Called once for each jump or loop restart with how far the leading stem landed from its anchor. */
  setLandingListener(listener: ((report: LandingReport) => void) | null): void {
    this.leader.setLandingListener(listener);
  }

  /** Applies a whole alignment, holds included; every stem keeps playing from where it is. */
  setAlignment(map: AlignmentMap): void {
    this.leader.setAlignment(map);
  }

  /** Sets the user's base mix; while a schedule runs on a loop, the current pass's mix is what plays. */
  setMix(mix: MixState): void {
    this.baseMix = mix;
    this.applyMix();
  }

  private resetPass(): void {
    this.passNumber = 1;
    this.applyMix();
    this.notifyPass();
  }

  private notifyPass(): void {
    for (const l of this.passListeners) l();
  }

  private applyMix(): void {
    const mix = this.leader.loop ? passMix(this.baseMix, this.schedule, this.passNumber) : this.baseMix;
    const gains = stemGains(mix);
    for (const c of this.channels) c.setGain(gains[c.name]);
  }

  /** Pulls followers that sit further than the tolerance from the leader back to it; idle during the lead-in. */
  resync(tolerance = DRIFT_TOLERANCE_SECONDS): void {
    if (this.leader.inLeadIn) return;
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

  /**
   * Keeps followers in step with the leader's state: held while it counts the lead-in, started at its
   * position once its element runs, and pulled back when they drift.
   */
  private followLeader(): void {
    if (!this.leader.playing) return;
    if (this.leader.inLeadIn) {
      for (const f of this.followers) if (!f.element.paused) f.element.pause();
      return;
    }
    this.resync();
    const target = this.channels[0].element.currentTime;
    for (const f of this.followers) {
      if (!f.element.paused) continue;
      f.element.currentTime = target;
      void f.element.play();
    }
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.time();
      this.followLeader();
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
