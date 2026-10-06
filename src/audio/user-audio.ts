import { AlignmentMap } from './alignment-map';
import { clamp, clampRate, normalizeLoop, type Clock, type LoopRange } from './clock';
import { clampOffset } from './offset-range';
import type { CountIn } from './count-in';
import type { ExactGate } from './exact-copy';

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

/** How far an element landed from where a jump or loop restart meant to put it, for the readout. */
export interface LandingReport {
  /** The tab time the jump aimed for. */
  readonly tab: number;
  /** Seconds between where the element was and where it should have been, before any correction. */
  readonly error: number;
  /** True when the element that landed seeks exactly: an exact copy, or a file that is exact already (WAV, stems). */
  readonly exact: boolean;
}

/** Seconds from a monotonic clock; the lead-in advances tab time from it. */
export type TimeSource = () => number;

const performanceSource: TimeSource = () => performance.now() / 1000;

/** Seconds a held jump plays on from the old spot before the recording and the tab pause. */
export const HOLD_PLAY_ON_SECONDS = 1;
/** Chunks of the recording a jump needs exact: the one it lands in and the one after, so playing on does not at once reach a gap. */
const JUMP_CHUNKS = 2;
/** How far ahead of the element playback is checked to be on exact audio, in seconds of the recording. */
const GUARD_SECONDS = 3;
/** Beats of the count-in before a held jump resumes. */
export const COUNT_IN_BEATS = 4;
/** After a part could not be made exact, the guard leaves playback alone for this long, so it does not hold again at once. */
const GUARD_BACKOFF_SECONDS = 5;

/** Where a jump into a part that is not exact yet stands: waiting while playback goes on, paused, counting in, or given up. */
export type HoldPhase = 'waiting' | 'paused' | 'counting' | 'failed';

export interface HoldState {
  readonly phase: HoldPhase;
  /** The tab time the jump is heading for. */
  readonly tab: number;
}

/** How far the element may sit from where a loop restart should have put it before it is moved back. */
const LANDING_TOLERANCE_SECONDS = 0.025;
/** How long after a restart the landing is first checked, one watcher tick. */
const LANDING_GRACE_SECONDS = 0.02;
/** A restart that keeps missing is corrected this many times, then left alone. */
const LANDING_MAX_CORRECTIONS = 3;

/**
 * A Clock backed by the user's own recording. Media time is the position in the tab. The recording leads:
 * tab time is read from the element's position through an alignment map, which is the recording position
 * equal to the tab time plus `offset` (a positive offset means the recording has extra lead-in, a negative
 * one that it starts after the tab), except where the map holds the tab still while the recording plays
 * extra material. A media element cannot sit before zero, so while the recording position is negative the
 * element waits at zero and the clock advances tab time itself from `source`, then starts the element when
 * the recording begins.
 * Tempo changes use the browser's pitch-preserving time stretch.
 */
export class UserAudioClock implements Clock {
  private map = AlignmentMap.fromOffset(0);
  private currentRate = 1;
  private loopRange: LoopRange | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;
  /** Set while playing in the silence before the recording: tab time at `anchorSource`. */
  private leadIn: { anchorTab: number; anchorSource: number } | null = null;
  /** Tab time while paused in the silence before the recording. */
  private heldTab: number | null = null;
  private onLoopWrap: (() => void) | null = null;
  /** Where the element should be, set whenever it is positioned while playing; verified once, then cleared. */
  private landing: {
    target: number;
    /** The tab time the placement was for. */
    tab: number;
    at: number;
    corrections: number;
    sawSeeking: boolean;
    /** True once the landing error has been reported, so each landing is reported once. */
    reported: boolean;
    /** Whether the element the placement was made on seeks exactly. */
    exact: boolean;
  } | null = null;
  /** True for a clock whose files all seek exactly (stems, a WAV recording), which needs no exact copy. */
  private seekExact = false;
  private onLanding: ((report: LandingReport) => void) | null = null;
  private onAdopt: ((element: AudioLike) => void) | null = null;
  /** Says which elements are exact copies and which parts they have; without one every jump is placed at once, as before. */
  private gate: ExactGate | null = null;
  private countIn: CountIn | null = null;
  private tempoAt: (tab: number) => number = () => 120;
  /** A jump waiting for the part of the recording it lands in to be exact. */
  private hold: { id: number; tab: number; phase: HoldPhase; since: number; resume: boolean } | null = null;
  private holdCount = 0;
  private onHold: ((state: HoldState | null) => void) | null = null;
  /** Source time before which the coverage guard leaves playback alone. */
  private guardResumesAt = 0;

  /** The element in use; it can be replaced once with a seek-exact copy, see `offerElement`. */
  private current: AudioLike;
  /** A replacement waiting for a point where the element is positioned anyway. */
  private pendingElement: AudioLike | null = null;

  constructor(
    initial: AudioLike,
    private readonly duration: number,
    readonly file: File | null = null,
    private readonly objectUrl: string | null = null,
    private readonly source: TimeSource = performanceSource,
  ) {
    this.current = initial;
    initial.preservesPitch = true;
  }

  get element(): AudioLike {
    return this.current;
  }

  /**
   * Offers an element that plays the same recording, such as a seek-exact copy. It takes over at the next
   * loop restart, seek or pause, where the element is repositioned anyway, so what is heard does not jump;
   * when nothing is playing it takes over at once. A second offer before the first applies replaces it.
   */
  offerElement(next: AudioLike): void {
    this.pendingElement = next;
    if (!this.playing) this.adoptPending(true);
  }

  /** Moves playback onto the waiting element. `carryPosition` copies the old element's position; a caller that is about to reposition it does not need to. */
  private adoptPending(carryPosition: boolean): void {
    const next = this.pendingElement;
    if (!next) return;
    this.pendingElement = null;
    const old = this.current;
    next.playbackRate = this.currentRate;
    next.preservesPitch = true;
    if (carryPosition) next.currentTime = old.currentTime;
    old.pause();
    this.current = next;
    this.onAdopt?.(next);
  }

  get playing(): boolean {
    return this.leadIn !== null || (!this.current.paused && !this.current.ended);
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

  /** The base offset of the alignment: where tab time zero sits in the recording. */
  get offset(): number {
    return this.map.base;
  }

  get alignment(): AlignmentMap {
    return this.map;
  }

  time(): number {
    if (this.leadIn) return this.leadInTime();
    if (this.heldTab !== null) return this.heldTab;
    const recording = this.current.currentTime;
    let media = this.map.toTab(recording);
    const loop = this.loopRange;
    // A loop wraps when the recording reaches its end, so a loop that ends on a hold's bar line wraps on arrival
    // and one that spans a hold plays the extra playing first.
    if (loop && this.playing && recording >= this.map.toRec(loop.end, 'end')) {
      media = loop.start;
      this.place(loop.start, true);
      this.onLoopWrap?.();
    }
    // A recording longer than the tab stops with the tab instead of playing on unseen.
    if (this.playing && media >= this.duration) this.current.pause();
    return clamp(media, 0, this.duration);
  }

  play(): void {
    this.cancelHold();
    if (this.time() >= this.duration) this.seek(this.loopRange?.start ?? 0);
    if (this.playing) {
      this.startWatcher();
      return;
    }
    if (this.heldTab === null && this.map.inHold(this.current.currentTime)) {
      // Tab time cannot say where in the extra playing the recording was, so resume the element where it is.
      this.adoptPending(true);
      this.landing = null;
      void this.current.play();
      this.startWatcher();
      return;
    }
    this.place(this.time(), true);
    this.startWatcher();
  }

  pause(): void {
    this.cancelHold();
    this.pauseElement();
  }

  private pauseElement(): void {
    if (this.leadIn) {
      this.heldTab = this.leadInTime();
      this.leadIn = null;
    }
    this.current.pause();
    this.adoptPending(true);
    this.landing = null;
    this.stopWatcher();
  }

  seek(seconds: number): void {
    const tab = clamp(seconds, 0, this.duration);
    this.cancelHold();
    if (this.needsExactCopy(tab)) {
      this.beginHold(tab);
      return;
    }
    this.place(tab, this.playing);
  }

  /** Whether a jump to `tab` would land on the recording's own file, or on a copy that lacks the part it points at. */
  private needsExactCopy(tab: number): boolean {
    const gate = this.gate;
    if (!gate) return false;
    const recording = this.map.toRec(tab, 'start');
    // Before the recording starts the element waits at zero, which every file reaches exactly.
    if (recording < 0) return false;
    return !gate.covers(this.pendingElement ?? this.current, recording, JUMP_CHUNKS);
  }

  /**
   * Holds a jump until the part it lands in is exact. A playing recording plays on from the old spot for a moment; if the part is
   * still not ready, it and the tab pause, and resume at the target after a count-in. A paused one just waits.
   */
  private beginHold(tab: number): void {
    const gate = this.gate!;
    const id = ++this.holdCount;
    this.hold = { id, tab, phase: 'waiting', since: this.source(), resume: this.playing };
    this.emitHold();
    if (this.playing) this.startWatcher();
    void gate.prepare(this.map.toRec(tab, 'start'), JUMP_CHUNKS).then((ready) => this.holdReady(id, ready));
  }

  private holdReady(id: number, ready: boolean): void {
    const hold = this.hold;
    if (!hold || hold.id !== id) return;
    if (!ready) {
      // The part could not be made exact: the jump lands on the element in use, and the player is told it may be off.
      this.hold = null;
      this.guardResumesAt = this.source() + GUARD_BACKOFF_SECONDS;
      this.onHold?.({ phase: 'failed', tab: hold.tab });
      this.place(hold.tab, hold.resume);
      if (hold.resume) this.startWatcher();
      return;
    }
    if (hold.phase === 'paused' && hold.resume) {
      void this.countInThenResume(hold.id);
      return;
    }
    this.hold = null;
    this.emitHold();
    this.place(hold.tab, hold.resume);
  }

  private async countInThenResume(id: number): Promise<void> {
    const hold = this.hold;
    if (!hold || hold.id !== id) return;
    hold.phase = 'counting';
    this.emitHold();
    if (this.countIn) await this.countIn.play(COUNT_IN_BEATS, this.tempoAt(hold.tab));
    if (!this.hold || this.hold.id !== id) return;
    this.hold = null;
    this.emitHold();
    this.place(hold.tab, true);
    this.startWatcher();
  }

  /** Gives up a held jump, as when the player pauses, plays or jumps somewhere else. */
  private cancelHold(): void {
    if (!this.hold) return;
    this.hold = null;
    this.countIn?.cancel();
    this.emitHold();
  }

  private emitHold(): void {
    this.onHold?.(this.holding);
  }

  /** Pauses a held jump's recording once the play-on has run out. */
  private checkHold(): void {
    const hold = this.hold;
    if (!hold || hold.phase !== 'waiting' || !hold.resume) return;
    if (this.source() - hold.since < HOLD_PLAY_ON_SECONDS) return;
    hold.phase = 'paused';
    this.pauseElement();
    this.emitHold();
  }

  /**
   * Playing on an exact copy runs into a part it does not have, which it would play as silence. Looking a little ahead, that
   * is held like a jump to the same spot, which lands on a newer copy when there is one.
   */
  private checkCoverage(): void {
    const gate = this.gate;
    if (!gate || this.hold || this.leadIn || this.current.paused || this.source() < this.guardResumesAt) return;
    const element = this.current;
    if (!gate.owns(element)) return;
    if (gate.covers(element, element.currentTime + GUARD_SECONDS * this.currentRate, 1)) return;
    this.beginHold(this.map.toTab(element.currentTime));
  }

  setRate(rate: number): void {
    // The lead-in counts tab time at the old rate up to now, then continues at the new one.
    if (this.leadIn) this.leadIn = { anchorTab: this.leadInTime(), anchorSource: this.source() };
    if (this.landing) this.landing = { ...this.landing, target: this.expectedLanding(), at: this.source() };
    this.currentRate = clampRate(rate, 0.25);
    this.current.playbackRate = this.currentRate;
    this.current.preservesPitch = true;
  }

  setLoop(range: LoopRange | null): void {
    this.loopRange = normalizeLoop(range);
  }

  /** Called once each time playback wraps from the loop end to its start, including during the lead-in silence. */
  setLoopWrapListener(listener: (() => void) | null): void {
    this.onLoopWrap = listener;
  }

  /** Where jumps ask whether the element in use can land them exactly; null puts every jump straight where it points. */
  setGate(gate: ExactGate | null): void {
    this.gate = gate;
  }

  /** Says that this clock's own files seek exactly, so every landing is reported as exact. */
  setSeekExact(exact: boolean): void {
    this.seekExact = exact;
  }

  /** What counts the player in when a held jump has paused playback. */
  setCountIn(countIn: CountIn | null): void {
    this.countIn = countIn;
  }

  /** The tempo, in beats a minute, of the tab at a tab time; the count-in follows it. */
  setTempoSource(tempoAt: (tab: number) => number): void {
    this.tempoAt = tempoAt;
  }

  /** Called whenever a held jump changes state: held, paused, counting in, given up (once), and null when it ends. */
  setHoldListener(listener: ((state: HoldState | null) => void) | null): void {
    this.onHold = listener;
  }

  /** The held jump, or null when nothing is held. */
  get holding(): HoldState | null {
    return this.hold ? { phase: this.hold.phase, tab: this.hold.tab } : null;
  }

  /** Called each time a waiting element takes over, with the element now in use. */
  setAdoptListener(listener: ((element: AudioLike) => void) | null): void {
    this.onAdopt = listener;
  }

  /** Called once for each jump or loop restart, with how far the element landed from where it was meant to. */
  setLandingListener(listener: ((report: LandingReport) => void) | null): void {
    this.onLanding = listener;
  }

  /**
   * Moves the recording against the tab, within the shared range; the recording keeps playing from
   * where it is, so the tab time moves instead. When nothing is playing and the recording has not
   * started, there is no position to keep, so the playhead stays where it is.
   */
  setOffset(seconds: number): void {
    this.setAlignment(this.map.withBase(clampOffset(seconds)));
  }

  /**
   * Replaces the whole alignment. Like `setOffset`, the recording keeps playing from where it is and tab
   * time moves to match the new map.
   */
  setAlignment(next: AlignmentMap): void {
    this.landing = null;
    if (this.leadIn) {
      // Reading the lead-in can hand over to the element, so look at the state again afterwards.
      const recording = this.map.toRec(this.leadInTime(), 'start');
      if (this.leadIn) {
        // Still before the recording's start: keep that position, move the tab against it.
        this.map = next;
        this.leadIn = { anchorTab: Math.max(0, next.toTab(recording)), anchorSource: this.source() };
        return;
      }
      // The element has taken over (or the tab ended): only the map changes.
      this.map = next;
      return;
    }
    if (this.heldTab !== null || (this.current.paused && this.current.currentTime === 0)) {
      const tab = this.time();
      this.map = next;
      this.place(tab, false);
      return;
    }
    this.map = next;
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
      this.current.pause();
      return this.duration;
    }
    if (this.map.toRec(tab, 'start') >= 0) {
      // Hand over to the element at the overshoot, so tab time neither jumps nor steps back.
      this.place(tab, true);
      tab = this.map.toTab(this.current.currentTime);
    }
    return clamp(tab, 0, this.duration);
  }

  /**
   * Puts the tab at `tab`. Before the recording starts the element waits at zero (counting the lead-in
   * when playing); otherwise the element goes to its position and runs if playback is on. The element
   * is never given a negative position.
   */
  private place(tab: number, playing: boolean): void {
    this.adoptPending(false);
    const recording = this.map.toRec(tab, 'start');
    if (recording < 0) {
      this.landing = null;
      if (!this.current.paused) this.current.pause();
      this.current.currentTime = 0;
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
    this.current.currentTime = recording;
    const exact = this.seekExact || (this.gate?.owns(this.current) ?? false);
    this.landing = playing ? { target: recording, tab, at: this.source(), corrections: 0, sawSeeking: false, reported: false, exact } : null;
    if (playing && this.current.paused) void this.current.play();
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
    let landing = this.landing;
    if (!landing || this.current.paused) return;
    if (this.current.seeking) {
      landing.sawSeeking = true;
      return;
    }
    if (landing.sawSeeking) {
      // The element only starts playing when its seek ends, so measure from there, not from the restart.
      landing = { ...landing, at: this.source(), sawSeeking: false };
      this.landing = landing;
    }
    if (this.source() - landing.at < LANDING_GRACE_SECONDS) return;
    const expected = this.expectedLanding();
    if (!landing.reported) {
      // The first measurement of a landing is the one that says how good the placement was.
      landing = { ...landing, reported: true };
      this.landing = landing;
      this.onLanding?.({ tab: landing.tab, error: Math.abs(this.current.currentTime - expected), exact: landing.exact });
    }
    if (Math.abs(this.current.currentTime - expected) <= LANDING_TOLERANCE_SECONDS) {
      this.landing = null;
      return;
    }
    if (landing.corrections >= LANDING_MAX_CORRECTIONS) {
      this.landing = null;
      return;
    }
    this.current.currentTime = expected;
    this.landing = { ...landing, target: expected, at: this.source(), corrections: landing.corrections + 1, sawSeeking: false };
  }

  /** Loop wrapping and the stop at the tab end are checked on a timer too, so they hold when frames are throttled. */
  private startWatcher(): void {
    if (this.watcher) return;
    this.watcher = setInterval(() => {
      this.time();
      this.checkLanding();
      this.checkHold();
      this.checkCoverage();
      if (!this.playing && !this.hold) this.stopWatcher();
    }, 20);
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
  }

  dispose(): void {
    this.cancelHold();
    this.stopWatcher();
    this.leadIn = null;
    this.landing = null;
    this.current.pause();
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
