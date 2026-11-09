import {
  CHECK_VERSION,
  differsFromShare,
  isStale,
  readCaptureCheck,
  writeCaptureCheck,
  type CheckOutcome,
  type CheckResult,
} from '../app/capture-check-setting';
import type { ProfileStorage } from '../audio/profile-store-web';
import { describeEffects, type CheckReport } from './capture-check';
import type { CaptureSession, RecorderChoice, StreamInspection } from './record-capture';

/** Where the record flow stands. The long recording itself is the hook's business once it is `recording`. */
export type FlowState =
  | { name: 'idle' }
  | { name: 'picking' }
  | { name: 'checking' }
  | { name: 'report'; variant: 'before-recording' | 'check-only'; result: CheckResult; canHear: boolean; weak: boolean }
  | { name: 'recording' }
  | { name: 'failed'; reason: string };

export type FlowMode = 'record' | 'recheck';

/** What came back from the test, kept in memory only so the player can hear it. */
export interface HeardSound {
  samples: Float32Array;
  sampleRate: number;
}

/** What running the check found. */
export interface CheckRun {
  report: CheckReport;
  /** The container and audio bitrate that lost least; left out when the encoder was not measured. */
  chosen: RecorderChoice;
  /** The second recorder was refused, so encoder loss was not measured. */
  encoderSkipped: boolean;
  heard: HeardSound | null;
}

export interface FlowDeps {
  /** Shares the page. Runs once per start: a second call would show a second picker. */
  acquire(): Promise<MediaStream>;
  inspect(stream: MediaStream): StreamInspection;
  /** Plays the test sound and compares it. Resolves early, with whatever it has, once `isAborted` turns true. */
  runCheck(stream: MediaStream, isAborted: () => boolean): Promise<CheckRun>;
  startRecorder(stream: MediaStream, choice: RecorderChoice): CaptureSession;
  storage: ProfileStorage | null;
  currentSampleRate(): number | null;
  now(): string;
}

export interface FlowHooks {
  onState(state: FlowState): void;
  /** The long recorder is running on the shared stream. */
  onRecording(session: CaptureSession): void;
  /** The player ended the share while the long recording ran. */
  onShareEnded(): void;
}

/** What is wrong with a share before any sound is compared: processing still on, or the whole screen shared. */
export function weaknessLines(share: StreamInspection): string[] {
  const lines: string[] = [];
  if (share.echoCancellation === true) lines.push('The browser is still applying echo cancellation to the sound.');
  if (share.noiseSuppression === true) lines.push('The browser is still applying noise suppression to the sound.');
  if (share.autoGainControl === true) lines.push('The browser is still levelling the sound with automatic gain.');
  if (share.surface === 'monitor') lines.push('You shared the whole screen, so sound from other apps can get into the recording. Share this tab instead, and tick "Share tab audio".');
  if (share.surface === 'window') lines.push('You shared a window, which usually carries no sound. Share this tab instead, and tick "Share tab audio".');
  return lines;
}

const sharesBadly = (share: StreamInspection): boolean => weaknessLines(share).length > 0;

/** What was shared and at what sample rate, so the player can see which setup the result is about. */
export function shareLine(share: StreamInspection): string | null {
  const what = share.surface === 'browser' ? "this tab's sound" : share.surface === 'monitor' ? "the whole screen's sound" : share.surface === 'window' ? "a window's sound" : null;
  const rate = share.sampleRate ? `${Math.round(share.sampleRate / 100) / 10} kHz` : null;
  if (what) return `Shared: ${what}${rate ? `, ${rate}` : ''}.`;
  return rate ? `Sample rate: ${rate}.` : null;
}

const NO_SOUND_LINE = 'No sound came with the share. Share the tab and tick "Share tab audio".';

function failureReason(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotSupportedError' || name === 'NotFoundError') return 'This app cannot capture the screen here, so Record with video is not available on this machine.';
  if (name === 'AbortError') return 'The capture was interrupted before it started.';
  return e instanceof Error && e.message ? e.message : 'The page could not be captured.';
}

/**
 * The first-record flow: share once, check the sound on that share before the long recorder exists (so the test sound can
 * never be in the file), then record. Everything is injected so it is tested with fakes; the clock is never touched here.
 */
export function createCaptureFlow(deps: FlowDeps, hooks: FlowHooks) {
  let state: FlowState = { name: 'idle' };
  let inFlight = false;
  /** Bumped by every start and every abort, so a call that outlives either can tell it is stale and leave the new run alone. */
  let generation = 0;
  let stream: MediaStream | null = null;
  let session: CaptureSession | null = null;
  let pendingChoice: RecorderChoice = {};
  let heard: HeardSound | null = null;

  const set = (next: FlowState) => {
    state = next;
    hooks.onState(next);
  };
  const release = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const finishTo = (next: FlowState) => {
    release();
    inFlight = false;
    set(next);
  };

  const startLong = (choice: RecorderChoice) => {
    if (!stream) return;
    try {
      session = deps.startRecorder(stream, choice);
    } catch (e) {
      finishTo({ name: 'failed', reason: failureReason(e) });
      return;
    }
    set({ name: 'recording' });
    hooks.onRecording(session);
  };

  const remember = (result: CheckResult) => writeCaptureCheck(result, deps.storage);

  const resultFor = (share: StreamInspection, outcome: CheckOutcome, lines: string[], run: CheckRun | null): CheckResult => ({
    v: CHECK_VERSION,
    at: deps.now(),
    captureWorks: true,
    outcome,
    surface: share.surface,
    echoCancellation: share.echoCancellation,
    noiseSuppression: share.noiseSuppression,
    autoGainControl: share.autoGainControl,
    sampleRate: share.sampleRate ?? deps.currentSampleRate(),
    lines,
    mime: run?.chosen.mime ?? null,
    audioBitsPerSecond: run?.chosen.audioBitsPerSecond ?? null,
  });

  const onShareEnded = () => {
    if (state.name === 'recording') {
      hooks.onShareEnded();
      return;
    }
    if (state.name === 'checking' || state.name === 'picking' || (state.name === 'report' && state.variant === 'before-recording')) {
      generation++;
      finishTo({ name: 'failed', reason: 'The share ended before the check finished.' });
    }
  };

  async function start(mode: FlowMode): Promise<void> {
    // A report left on screen does not block a new start: it is replaced, and its share released.
    if (inFlight && state.name === 'report') finishTo({ name: 'idle' });
    if (inFlight) return;
    inFlight = true;
    const gen = ++generation;
    const stale = () => gen !== generation;
    heard = null;
    set({ name: 'picking' });

    let acquired: MediaStream;
    try {
      acquired = await deps.acquire();
    } catch (e) {
      if (stale()) return;
      if (e instanceof Error && e.name === 'NotAllowedError') {
        inFlight = false;
        set({ name: 'idle' });
        return;
      }
      const stored = readCaptureCheck(deps.storage);
      if (!stored || stored.captureWorks) {
        remember({ ...resultFor({ hasAudio: false, audioLive: false, echoCancellation: null, noiseSuppression: null, autoGainControl: null, sampleRate: null, channelCount: null, surface: 'unknown' }, 'failed', [failureReason(e)], null), captureWorks: false });
      }
      inFlight = false;
      set({ name: 'failed', reason: failureReason(e) });
      return;
    }
    if (stale()) {
      // Cancelled while the picker was open; only the share this call got is released, the newer run owns the rest.
      acquired.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = acquired;
    stream.getVideoTracks()[0]?.addEventListener('ended', onShareEnded);

    const share = deps.inspect(stream);
    const stored = readCaptureCheck(deps.storage);
    // A remembered result that found no sound is checked again, since the share may carry sound now.
    const usable = stored !== null && stored.captureWorks && stored.outcome !== 'no-audio' && stored.outcome !== 'nothing' && !isStale(stored, share.sampleRate ?? deps.currentSampleRate());

    if (mode === 'record' && usable) {
      pendingChoice = { mime: stored.mime ?? undefined, audioBitsPerSecond: stored.audioBitsPerSecond ?? undefined };
      const differs = differsFromShare(stored, share);
      if (differs || stored.outcome === 'altered' || sharesBadly(share)) {
        // A different share than the one checked, or a weak one the player already knows about: warn again, with no test sound.
        const lines = differs ? (share.hasAudio ? weaknessLines(share) : [NO_SOUND_LINE]) : stored.lines;
        const result = differs
          ? { ...stored, surface: share.surface, echoCancellation: share.echoCancellation, noiseSuppression: share.noiseSuppression, autoGainControl: share.autoGainControl, outcome: share.hasAudio ? stored.outcome : ('no-audio' as const), lines: lines.length ? lines : ['This share differs from the one that was checked.'] }
          : stored;
        set({ name: 'report', variant: 'before-recording', canHear: false, weak: true, result });
        return;
      }
      startLong(pendingChoice);
      return;
    }

    set({ name: 'checking' });
    let run: CheckRun | null = null;
    if (share.hasAudio && share.audioLive) {
      try {
        run = await deps.runCheck(stream, stale);
      } catch (e) {
        if (!stale()) finishTo({ name: 'failed', reason: failureReason(e) });
        return;
      }
    }
    if (stale()) {
      // Stop, or the share ending, already released the stream and moved the state.
      return;
    }

    let outcome: CheckOutcome;
    let lines: string[];
    if (run === null) {
      outcome = 'no-audio';
      lines = [NO_SOUND_LINE];
    } else {
      outcome = run.report.verdict;
      lines = describeEffects(run.report);
      if (run.encoderSkipped) lines.push('The encoder was not measured on this machine.');
    }
    lines.push(...weaknessLines(share));
    const shared = shareLine(share);
    if (run !== null && shared) lines.push(shared);
    const result = resultFor(share, outcome, lines, run);
    remember(result);
    heard = run?.heard ?? null;
    pendingChoice = run?.chosen ?? {};

    const weak = outcome !== 'clean' || sharesBadly(share);
    if (mode === 'recheck') {
      release();
      set({ name: 'report', variant: 'check-only', result, canHear: heard !== null, weak });
      return;
    }
    if (weak) {
      set({ name: 'report', variant: 'before-recording', result, canHear: heard !== null, weak });
      return;
    }
    startLong(pendingChoice);
  }

  return {
    start,
    /** Record anyway, from a warning. */
    proceed(): void {
      if (state.name === 'report' && state.variant === 'before-recording') startLong(pendingChoice);
    },
    /** Stop, Close, or the page going away: ends whatever is in flight and returns to idle with the tracks stopped. */
    abort(): void {
      generation++;
      session?.cancel();
      session = null;
      heard = null;
      if (!inFlight && state.name === 'idle') return;
      finishTo({ name: 'idle' });
    },
    /** The long recording has finished and been handed on. */
    finished(): void {
      session = null;
      release();
      inFlight = false;
      set({ name: 'idle' });
    },
    /** What came back from the test, for the Hear it yourself button. */
    heardSound: (): HeardSound | null => heard,
    state: (): FlowState => state,
  };
}
