/**
 * Reopening a saved song (R8–R11, R13, R15): what to restore and in which order, decided from the library entry and the
 * tab just read. App.tsx carries the steps out; every decision that varies between songs lives here.
 */

import type { model as AlphaModel } from '@coderline/alphatab';
import { buildTimeline } from '../model/alphatab-adapter';
import { playbackBarIndexAt } from '../model/bars';
import { applyFileTuning, captureTunings, type WrittenTunings } from '../model/file-tuning';
import { FILE_TUNING, presetById } from '../model/retune';
import type { Timeline } from '../model/score';
import type { BackingSource, LibraryEntry, VideoRef } from './library';
import { firstPlayableTrack } from './open-file';
import type { AudioSource } from './youtube-dock';
import type { YoutubeVideoStore } from './youtube-video-store';

/** The one note shown when a reopened song's stored recording is missing or unreadable (R13). */
export const RECORDING_MISSING = 'The saved recording for this song is missing. Load a recording to replace it.';

/** The error shown on the start screen when a saved song's tab cannot be read back. */
export const TAB_MISSING = "This song's tab couldn't be read from your library. Open the tab file again to save it.";

export type RestoreStep =
  /** Opens the tab on the saved track and file tuning (KTD7). */
  | { kind: 'tab'; trackIndex: number; tuningId: string }
  /** Puts playback, paused, at the start of the saved bar, in tab seconds (R8, R9; KTD4). */
  | { kind: 'seek'; tabSeconds: number }
  /** Makes the YouTube store say what the song says: its video at its offset, or none (KTD4). */
  | { kind: 'seed-video'; video: VideoRef | null }
  /** The audio last heard; held before the recording loads so its arrival does not take over from the video (AE2). */
  | { kind: 'select-source'; source: AudioSource }
  | { kind: 'load-recording'; file: File }
  | { kind: 'note'; text: string };

/** Whether the tab still has the saved track, with notes. */
function keepsTrack(stored: number, timeline: Timeline): boolean {
  return !!timeline.tracks[stored] && timeline.notesForTrack(stored).length > 0;
}

/** The saved track when the tab still has it with notes, otherwise the track a new tab opens on. */
export function restoreTrack(stored: number, timeline: Timeline): number {
  return keepsTrack(stored, timeline) ? stored : firstPlayableTrack(timeline);
}

/** The saved file tuning when this version knows it, otherwise the tuning written in the file. */
export function restoreTuning(stored: string): string {
  return stored !== FILE_TUNING && presetById(stored) ? stored : FILE_TUNING;
}

/** The YouTube hook's source for the backing the song remembers: the video's own audio, or the app's side. */
export function hookSourceFor(source: BackingSource): AudioSource {
  return source === 'video' ? 'original' : 'synth';
}

/** Where a reopened song starts, in tab seconds: the start of its saved played bar, or 0 when it has none or the bar is gone (R8, R9). */
export function resumeSeconds(entry: Pick<LibraryEntry, 'position'>, timeline: Timeline): number {
  const bar = entry.position === undefined ? undefined : timeline.bars[entry.position];
  return bar?.startSeconds ?? 0;
}

/** The position to save for a song at `tabSeconds`: its played bar (repeats expanded), or bar 1 at the end of the song (R7). */
export function positionToSave(timeline: Timeline, tabSeconds: number, atEnd: boolean): number {
  return atEnd ? 0 : playbackBarIndexAt(timeline, tabSeconds);
}

/**
 * The tab's timeline with a file tuning applied before it is built, so the synth is built once (KTD7), plus what the file
 * wrote, so a later tuning choice still starts from the file. The fingerprint is timing-only and does not change.
 */
export function tabWithTuning(score: AlphaModel.Score, trackIndex: number, tuningId: string): { timeline: Timeline; written: WrittenTunings } {
  const written = captureTunings(score);
  const preset = tuningId === FILE_TUNING ? undefined : presetById(tuningId);
  if (preset) applyFileTuning(score, written, trackIndex, preset.tuning);
  return { timeline: buildTimeline(score), written };
}

/** The video and offset the YouTube store has for a tab, or null when none is attached; a missing offset reads as 0. */
export function storedVideo(store: YoutubeVideoStore, fingerprint: string): VideoRef | null {
  const videoId = store.videoFor(fingerprint);
  return videoId ? { videoId, offsetSeconds: store.offsetFor(fingerprint) ?? 0 } : null;
}

/** Points the store at the song's video and offset, or detaches whatever another song left under the same fingerprint. */
export function seedVideoStore(store: YoutubeVideoStore, fingerprint: string, video: VideoRef | null): void {
  if (!video) {
    store.detach(fingerprint);
    return;
  }
  store.attach(fingerprint, video.videoId);
  store.saveOffset(fingerprint, video.offsetSeconds);
}

/**
 * The steps that bring a song back: the tab, the seek to its saved bar, its video, the source last heard, then its recording, or the R13 note when the
 * stored recording could not be read (`recording` null for a song that has one).
 */
export function planRestore(entry: LibraryEntry, timeline: Timeline, recording: File | null): RestoreStep[] {
  // The saved tuning was chosen for the saved track, so a fallback track opens in the tuning its file wrote.
  const kept = keepsTrack(entry.trackIndex, timeline);
  const steps: RestoreStep[] = [
    {
      kind: 'tab',
      trackIndex: kept ? entry.trackIndex : firstPlayableTrack(timeline),
      tuningId: kept ? restoreTuning(entry.tuningId) : FILE_TUNING,
    },
    { kind: 'seek', tabSeconds: resumeSeconds(entry, timeline) },
    { kind: 'seed-video', video: entry.video },
  ];
  if (entry.video && entry.source) steps.push({ kind: 'select-source', source: hookSourceFor(entry.source) });
  if (entry.recording) steps.push(recording ? { kind: 'load-recording', file: recording } : { kind: 'note', text: RECORDING_MISSING });
  return steps;
}

/**
 * Runs the steps in order. Each starts only while the reopen is still current, so opening another file or song abandons the
 * rest (R15). A step that returns nothing runs on without yielding, so the tab, video and source are all in place before
 * the page next renders. False when the reopen was abandoned.
 */
export async function runRestore(
  steps: readonly RestoreStep[],
  run: (step: RestoreStep) => void | Promise<unknown>,
  isCurrent: () => boolean,
): Promise<boolean> {
  for (const step of steps) {
    if (!isCurrent()) return false;
    const result = run(step);
    if (result) await result;
  }
  return isCurrent();
}

/** Starting a reopened recording's saved stems by itself, once, when the engine is ready (KTD8). */
export interface StemsAutoStart {
  /** The reopened recording whose saved stems should start. */
  arm(recording: File): void;
  /** The player changed the mix or chose what plays; nothing starts by itself any more. */
  cancel(): void;
  /** True once, when the armed recording's saved stems should start now. */
  take(state: { recording: File | null; engineReady: boolean; hasSaved: boolean; active: boolean; busy: boolean }): boolean;
}

export function createStemsAutoStart(): StemsAutoStart {
  let armed: File | null = null;
  return {
    arm(recording) {
      armed = recording;
    },
    cancel() {
      armed = null;
    },
    take({ recording, engineReady, hasSaved, active, busy }) {
      if (!armed) return false;
      if (recording !== armed) {
        // Another recording replaced the reopened one.
        if (recording) armed = null;
        return false;
      }
      if (!engineReady || !hasSaved || active || busy) return false;
      armed = null;
      return true;
    },
  };
}
