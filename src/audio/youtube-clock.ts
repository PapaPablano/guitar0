import type { EmbeddedPlayer } from '../app/youtube-player';
import { AlignmentMap } from './alignment-map';
import { clamp, normalizeLoop, type Clock, type LoopRange } from './clock';
import { clampOffset } from './offset-range';

/** Seconds from a monotonic clock; the clock interpolates between the player's position reports from it. */
export type TimeSource = () => number;

const performanceSource: TimeSource = () => performance.now() / 1000;

/** How far the video may sit from where a loop restart or jump should have put it before it is moved back. */
export const LANDING_TOLERANCE_SECONDS = 0.15;
/** How long after a jump the landing is first checked: the player reports its position in steps. */
const LANDING_GRACE_SECONDS = 0.6;
/** A jump that keeps missing is corrected this many times, then left alone. */
const LANDING_MAX_CORRECTIONS = 2;
/** The rates the embed is known to play, used until the player says which it offers. */
const FALLBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
/** A change in the player's position bigger than this is a jump, not the next report of steady playing. */
const JUMP_SECONDS = 0.75;
/** A paused video this far from the playhead has been moved by the player, with the embed's own controls. */
const SCRUB_SECONDS = 0.05;
/** After the clock moves or pauses the player, its position and state are not read back for this long: they report in steps. */
const SETTLE_SECONDS = 0.8;
/** A video that reports no new position for this long while the player says it is not playing has stopped (paused, buffering or ended). */
const STALL_SECONDS = 2;
/** Two rates this close are the same rate. */
const RATE_EPSILON = 0.001;

/** What the player is told when it is not playing at the tempo that was asked for, or null when it is. */
export function rateNotice(requested: number, applied: number): string | null {
  if (Math.abs(requested - applied) <= RATE_EPSILON) return null;
  const percent = (r: number) => `${Math.round(r * 100)}%`;
  return `The video can only play at ${percent(applied)}, not ${percent(requested)}. Use the synth for that tempo.`;
}

/** The offered rate closest to `wanted`; the lower one when two are equally close. */
export function nearestRate(wanted: number, offered: readonly number[]): number {
  const rates = offered.length > 0 ? offered : FALLBACK_RATES;
  let best = rates[0];
  for (const rate of rates) {
    if (Math.abs(rate - wanted) < Math.abs(best - wanted) - RATE_EPSILON) best = rate;
  }
  return best;
}

/**
 * A Clock backed by an embedded video. Media time is the position in the tab. The video leads: tab time is the video's
 * position minus `offset` (a positive offset means the video has extra lead-in before the tab starts). The embed reports its
 * position in steps, so tab time is interpolated between reports at the rate the player is really playing at. While the
 * video position would be negative the player waits at zero and the clock advances tab time itself, then starts the player.
 */
export class YoutubeClock implements Clock {
  private map = AlignmentMap.fromOffset(0);
  private appliedRate = 1;
  private loopRange: LoopRange | null = null;
  private intent: 'playing' | 'paused' = 'paused';
  private parkedFlag = false;
  /** Tab time while paused or parked. */
  private heldTab = 0;
  /** Set while playing in the silence before the video: tab time at `anchorSource`. */
  private leadIn: { anchorTab: number; anchorSource: number } | null = null;
  /** The last video position the player reported, and the source time it was first seen at. */
  private reported = { video: 0, at: 0 };
  private estimate = 0;
  /** Source time before which the player's reports are not trusted to show what the player itself did. */
  private settleUntil = 0;
  private landing: { target: number; at: number; corrections: number } | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;
  private onLoopWrap: (() => void) | null = null;

  constructor(
    private readonly player: EmbeddedPlayer,
    private readonly duration: number,
    private readonly source: TimeSource = performanceSource,
  ) {}

  get playing(): boolean {
    return this.intent === 'playing' && !this.parkedFlag;
  }

  /** The rate the video is really playing at, which the views and the loop follow. */
  get rate(): number {
    return this.appliedRate;
  }

  get loop(): LoopRange | null {
    return this.loopRange;
  }

  /** The base offset: where tab time zero sits in the video. */
  get offset(): number {
    return this.map.base;
  }

  get alignment(): AlignmentMap {
    return this.map;
  }

  /** True while the clock is counting the silence before the video and the player is not running. */
  get inLeadIn(): boolean {
    return this.leadIn !== null;
  }

  get parked(): boolean {
    return this.parkedFlag;
  }

  /** Where the video is, in seconds of the video itself: what Sync here pairs with the tab's first note. */
  videoTime(): number {
    return this.player.time();
  }

  /** The rate the player would play at if asked for `requested`, so the tempo notice can be shown before it is applied. */
  appliedRateFor(requested: number): number {
    return nearestRate(requested, this.player.availableRates());
  }

  time(): number {
    if (!this.playing) return this.followPlayerWhilePaused();
    if (this.leadIn) return this.leadInTime();
    if (this.stalled()) {
      // The player stopped by itself, with its own controls or by running out of video: the views stop with it.
      this.heldTab = this.clampedTab(this.reported.video - this.map.base);
      this.intent = 'paused';
      this.landing = null;
      this.settleUntil = this.source() + SETTLE_SECONDS;
      this.stopWatcher();
      return this.heldTab;
    }
    let tab = this.tabFromVideo();
    const loop = this.loopRange;
    if (loop && tab >= loop.end) {
      this.place(loop.start, true);
      this.onLoopWrap?.();
      return loop.start;
    }
    if (tab >= this.duration) {
      this.player.pause();
      this.intent = 'paused';
      this.settleUntil = this.source() + SETTLE_SECONDS;
      this.heldTab = this.duration;
      this.stopWatcher();
      return this.duration;
    }
    tab = clamp(tab, 0, this.duration);
    return tab;
  }

  play(): void {
    if (this.parkedFlag || this.playing) return;
    const start = this.time() >= this.duration ? (this.loopRange?.start ?? 0) : this.heldTab;
    this.place(start, true);
    this.startWatcher();
  }

  pause(): void {
    if (!this.playing) return;
    this.heldTab = this.time();
    this.intent = 'paused';
    this.leadIn = null;
    this.landing = null;
    this.settleUntil = this.source() + SETTLE_SECONDS;
    this.player.pause();
    this.stopWatcher();
  }

  seek(seconds: number): void {
    const tab = clamp(seconds, 0, this.duration);
    if (this.parkedFlag) {
      this.heldTab = tab;
      return;
    }
    this.place(tab, this.playing);
  }

  /** Asks for a tempo as a multiple of the original; the player plays the nearest rate it offers (see `rateMessage`). */
  setRate(rate: number): void {
    const tab = this.playing ? this.time() : this.heldTab;
    const applied = nearestRate(rate, this.player.availableRates());
    this.player.setRate(applied);
    this.appliedRate = this.player.rate() || applied;
    if (this.leadIn) this.leadIn = { anchorTab: tab, anchorSource: this.source() };
    else this.reanchor();
  }

  setLoop(range: LoopRange | null): void {
    this.loopRange = normalizeLoop(range);
  }

  /** Called once each time playback wraps from the loop end to its start. */
  setLoopWrapListener(listener: (() => void) | null): void {
    this.onLoopWrap = listener;
  }

  /**
   * Moves the video against the tab, within the shared range. A playing video keeps playing from where it is, so tab time
   * moves; a paused one keeps the playhead on the same tab time and moves the video to match.
   */
  setOffset(seconds: number): void {
    this.setAlignment(AlignmentMap.fromOffset(clampOffset(seconds)));
  }

  /** Replaces the alignment. Only its base offset applies: a video has no extra playing to hold the tab for. */
  setAlignment(next: AlignmentMap): void {
    const base = AlignmentMap.fromOffset(clampOffset(next.base));
    if (this.leadIn) {
      const video = this.videoFromTab(this.leadInTime());
      this.map = base;
      this.leadIn = { anchorTab: Math.max(0, video - base.base), anchorSource: this.source() };
      return;
    }
    if (!this.playing) {
      const tab = this.heldTab;
      this.map = base;
      if (!this.parkedFlag) this.place(tab, false);
      return;
    }
    this.map = base;
    this.reanchor();
  }

  /** Pauses and mutes the video so the synth can play instead; `resumeAt` brings it back. */
  park(): void {
    if (this.parkedFlag) return;
    this.heldTab = this.playing ? this.time() : this.heldTab;
    this.player.pause();
    this.player.mute();
    this.intent = 'paused';
    this.leadIn = null;
    this.landing = null;
    this.parkedFlag = true;
    this.stopWatcher();
  }

  /** Brings a parked video back at a tab time, playing when asked to. */
  resumeAt(tab: number, playing: boolean): void {
    this.parkedFlag = false;
    this.player.unmute();
    this.place(clamp(tab, 0, this.duration), playing);
    if (playing) this.startWatcher();
  }

  dispose(): void {
    this.stopWatcher();
    this.leadIn = null;
    this.landing = null;
    try {
      this.player.pause();
    } catch {
      // The embed may already be gone; there is nothing left to pause.
    }
  }

  /**
   * While paused, the views follow the embed's own controls: a position the player scrubbed to becomes the playhead, and
   * a video the player started on its own takes over as playing.
   */
  private followPlayerWhilePaused(): number {
    if (this.parkedFlag || this.source() < this.settleUntil) return this.heldTab;
    if (this.player.playing()) {
      this.intent = 'playing';
      this.leadIn = null;
      this.landing = null;
      this.reanchor();
      this.startWatcher();
      return this.clampedTab(this.tabFromVideo());
    }
    const expected = Math.max(0, this.videoFromTab(this.heldTab));
    const video = this.player.time();
    if (Math.abs(video - expected) > SCRUB_SECONDS) {
      this.heldTab = this.clampedTab(video - this.map.base);
      this.reanchor();
    }
    return this.heldTab;
  }

  private clampedTab(tab: number): number {
    return clamp(tab, 0, this.duration);
  }

  private videoFromTab(tab: number): number {
    return tab + this.map.base;
  }

  /** Whether the player has stopped reporting new positions and says it is not playing. */
  private stalled(): boolean {
    const now = this.source();
    return now >= this.settleUntil && now - this.reported.at > STALL_SECONDS && !this.player.playing();
  }

  /** Tab time from the player's position, interpolated between its reports at the rate it plays at. */
  private tabFromVideo(): number {
    const now = this.source();
    // Just after the clock moved the player, what it reports may still be where it was, so the clock only interpolates.
    const video = now < this.settleUntil ? this.reported.video : this.player.time();
    if (video !== this.reported.video) {
      // A position far from where the clock expected it is a jump (the player scrubbed or looped), not a report.
      if (Math.abs(video - this.estimate) > JUMP_SECONDS) this.estimate = video;
      this.reported = { video, at: now };
    }
    const interpolated = this.reported.video + Math.max(0, now - this.reported.at) * this.appliedRate;
    // A position never runs backwards between reports, except when a jump moved it.
    this.estimate = Math.max(this.estimate, interpolated);
    return this.estimate - this.map.base;
  }

  private reanchor(): void {
    const video = this.player.time();
    this.reported = { video, at: this.source() };
    this.estimate = video;
  }

  /**
   * Puts the video at `tab`. Before the video starts it waits at zero (counting the lead-in when playing); otherwise it
   * goes to its position and runs if playback is on. The player is never given a negative position.
   */
  private place(tab: number, playing: boolean): void {
    const video = this.videoFromTab(tab);
    this.intent = playing ? 'playing' : 'paused';
    this.heldTab = tab;
    this.settleUntil = this.source() + SETTLE_SECONDS;
    if (video < 0) {
      this.landing = null;
      this.player.pause();
      this.player.seek(0);
      this.leadIn = playing ? { anchorTab: tab, anchorSource: this.source() } : null;
      this.estimate = 0;
      this.reported = { video: 0, at: this.source() };
      return;
    }
    this.leadIn = null;
    this.player.seek(video);
    this.estimate = video;
    this.reported = { video, at: this.source() };
    this.landing = playing ? { target: video, at: this.source(), corrections: 0 } : null;
    if (playing) this.player.play();
    else this.player.pause();
  }

  /** Tab time during the lead-in; ends the lead-in when the video begins or the tab ends. */
  private leadInTime(): number {
    const lead = this.leadIn!;
    const tab = lead.anchorTab + (this.source() - lead.anchorSource) * this.appliedRate;
    const loop = this.loopRange;
    if (loop && tab >= loop.end) {
      this.place(loop.start, true);
      this.onLoopWrap?.();
      return loop.start;
    }
    if (tab >= this.duration) {
      this.leadIn = null;
      this.intent = 'paused';
      this.heldTab = this.duration;
      return this.duration;
    }
    if (this.videoFromTab(tab) >= 0) {
      // Hand over to the player at the overshoot, so tab time neither jumps nor steps back.
      this.place(tab, true);
      return tab;
    }
    return clamp(tab, 0, this.duration);
  }

  /** Checks, once the player has settled, that a jump put it where it should be, and moves it back when it did not. */
  private checkLanding(): void {
    const landing = this.landing;
    if (!landing || !this.playing || this.leadIn) return;
    if (this.source() - landing.at < LANDING_GRACE_SECONDS) return;
    const expected = landing.target + (this.source() - landing.at) * this.appliedRate;
    const actual = this.player.time();
    if (Math.abs(actual - expected) <= LANDING_TOLERANCE_SECONDS || landing.corrections >= LANDING_MAX_CORRECTIONS) {
      this.landing = null;
      return;
    }
    this.player.seek(expected);
    this.estimate = expected;
    this.reported = { video: expected, at: this.source() };
    this.landing = { target: expected, at: this.source(), corrections: landing.corrections + 1 };
  }

  /** Loop wrapping and the stop at the tab end are checked on a timer too, so they hold when frames are throttled. */
  private startWatcher(): void {
    if (this.watcher) return;
    this.watcher = setInterval(() => {
      this.time();
      this.checkLanding();
      if (!this.playing) this.stopWatcher();
    }, 50);
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
  }
}
