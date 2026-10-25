import { OFFSET_MAX_SECONDS } from '../audio/offset-range';
import type { AlignStatus, NotFoundReason } from './auto-align';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function notFoundText(reason: NotFoundReason): string {
  switch (reason) {
    case 'too-long':
      return 'This recording or tab is too long to line up automatically.';
    case 'silent':
      return 'The recording or the tab has no sound to compare, so it was not lined up.';
    case 'out-of-range':
      return `The recording starts more than ${OFFSET_MAX_SECONDS} seconds away from the tab, so it was not lined up.`;
    case 'not-confident':
      return 'Could not line the recording up with the tab.';
    case 'inconsistent':
      return 'Detection did not give a consistent result.';
  }
}

const skippedText = (skipped: number): string =>
  skipped > 0 ? ` The tab jumps past ${skipped} ${plural(skipped, 'stretch the recording skips', 'stretches the recording skips')}.` : '';

/** What the panel says about the detection, in the user's words. */
export function statusText(status: AlignStatus): string {
  switch (status.phase) {
    case 'idle':
      return '';
    case 'waiting':
      return "Waiting for the tab's sound to load before lining the recording up.";
    case 'analysing':
      return status.again
        ? `Detecting this recording's timing again… ${Math.round(status.progress * 100)}%`
        : `Lining the recording up with the tab… ${Math.round(status.progress * 100)}%`;
    case 'lined-up':
      return `Lined up with the tab.${skippedText(status.skipped)}`;
    case 'roughly':
      return `Roughly lined up: some bar lines may be off by more than a few hundredths of a second.${skippedText(status.skipped)}`;
    case 'not-found':
      return `${notFoundText(status.reason)} The recording plays against the offset alone.`;
    case 'failed':
      return status.reason === 'no-sound'
        ? "Lining up needs the tab's sound, which could not be loaded. The recording plays against the offset alone."
        : 'Lining the recording up failed. The recording plays against the offset alone.';
    case 'kept-previous':
      switch (status.cause) {
        case 'tab-changed':
          return 'The tab has changed since this recording was lined up, and detecting again did not give a consistent result, so the earlier timeline was kept.';
        case 'check-failed':
          return 'The saved timeline no longer matched this recording, and detecting again did not give a consistent result, so the earlier timeline was kept.';
        default:
          return 'Detecting again did not give a consistent result, so the timeline already in use was kept.';
      }
  }
}

/** What the controls do in a state: derived in one place so the offset control, playback and export agree (KTD13). */
export interface StateControls {
  /** The global offset is the only manual control, and shows only while no timeline is committed and no detection is running. */
  readonly showOffset: boolean;
  /** Why export is unavailable right now, or null when it is available. */
  readonly exportBlockedReason: string | null;
  /** Whether Re-analyse can be pressed. */
  readonly canReanalyse: boolean;
}

export function controlsFor(status: AlignStatus, ctx: { hasTimeline: boolean; hasRecordingFile: boolean }): StateControls {
  const running = status.phase === 'analysing' || status.phase === 'waiting';
  return {
    showOffset: !ctx.hasTimeline && !running,
    exportBlockedReason: running ? 'Export waits until the recording is lined up with the tab.' : null,
    canReanalyse: ctx.hasRecordingFile && !running,
  };
}
