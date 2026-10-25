import { defaultProfileStorage, type ProfileStorage } from '../audio/profile-store-web';
import type { ShareSurface, StreamInspection } from '../export/record-capture';

/** Where the last setup check is kept in browser storage, for this machine. */
export const CAPTURE_CHECK_KEY = 'tab-highway.capture-check';

/** Bumped only when the audio request or the comparison changes, so an old result is checked again. */
export const CHECK_VERSION = 1;

/** How the last check ended: the sound came through, was altered, was missing, no audio came with the share, or capture failed. */
export type CheckOutcome = 'clean' | 'altered' | 'nothing' | 'no-audio' | 'failed';

export interface CheckResult {
  v: number;
  /** When the check ran, as an ISO time. */
  at: string;
  /** Whether the shell or browser let the page capture at all; false is kept so the owner can read it later. */
  captureWorks: boolean;
  outcome: CheckOutcome;
  surface: ShareSurface;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  sampleRate: number | null;
  /** The plain-word findings the player was shown. */
  lines: string[];
  /** The container and audio bitrate the check found to lose least; later recordings use them. */
  mime: string | null;
  audioBitsPerSecond: number | null;
}

const OUTCOMES: readonly CheckOutcome[] = ['clean', 'altered', 'nothing', 'no-audio', 'failed'];
const SURFACES: readonly ShareSurface[] = ['browser', 'window', 'monitor', 'unknown'];

const flag = (value: unknown): boolean | null | undefined => (value === null || typeof value === 'boolean' ? value : undefined);
const numberOrNull = (value: unknown): number | null | undefined => (value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined);

/** A stored value read defensively; anything that is not a current result counts as none. */
function parse(raw: string): CheckResult | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const echo = flag(r.echoCancellation);
  const noise = flag(r.noiseSuppression);
  const gain = flag(r.autoGainControl);
  const rate = numberOrNull(r.sampleRate);
  if (r.v !== CHECK_VERSION || typeof r.at !== 'string' || typeof r.captureWorks !== 'boolean') return null;
  if (!OUTCOMES.includes(r.outcome as CheckOutcome) || !SURFACES.includes(r.surface as ShareSurface)) return null;
  if (echo === undefined || noise === undefined || gain === undefined || rate === undefined) return null;
  if (!Array.isArray(r.lines) || !r.lines.every((l) => typeof l === 'string')) return null;
  return {
    v: CHECK_VERSION,
    at: r.at,
    captureWorks: r.captureWorks,
    outcome: r.outcome as CheckOutcome,
    surface: r.surface as ShareSurface,
    echoCancellation: echo,
    noiseSuppression: noise,
    autoGainControl: gain,
    sampleRate: rate,
    lines: r.lines as string[],
    mime: typeof r.mime === 'string' ? r.mime : null,
    audioBitsPerSecond: numberOrNull(r.audioBitsPerSecond) ?? null,
  };
}

/** The remembered result for this machine, or null when there is none, it is unreadable, or it is from an older check. */
export function readCaptureCheck(storage: ProfileStorage | null = defaultProfileStorage()): CheckResult | null {
  try {
    const raw = storage?.getItem(CAPTURE_CHECK_KEY);
    return raw ? parse(raw) : null;
  } catch {
    return null;
  }
}

/** Remembers the result. A store that cannot be written to is skipped without a word: the check just runs again next time. */
export function writeCaptureCheck(result: CheckResult, storage: ProfileStorage | null = defaultProfileStorage()): void {
  try {
    storage?.setItem(CAPTURE_CHECK_KEY, JSON.stringify(result));
  } catch {
    // a blocked or full store only means the result is not kept
  }
}

/** Whether the machine's audio rate has changed since the result, which means the setup is not the one that was checked. */
export function isStale(result: CheckResult, currentSampleRate: number | null): boolean {
  return result.sampleRate !== null && currentSampleRate !== null && result.sampleRate !== currentSampleRate;
}

/** Whether a new share differs from the one the result describes: another surface, audio gained or lost, or a stage now active. */
export function differsFromShare(result: CheckResult, share: StreamInspection): boolean {
  if (result.surface !== share.surface) return true;
  if ((result.outcome !== 'no-audio') !== share.hasAudio) return true;
  const pairs: Array<[boolean | null, boolean | null]> = [
    [result.echoCancellation, share.echoCancellation],
    [result.noiseSuppression, share.noiseSuppression],
    [result.autoGainControl, share.autoGainControl],
  ];
  return pairs.some(([stored, now]) => stored !== null && now !== null && stored !== now);
}
