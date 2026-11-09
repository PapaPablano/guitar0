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
import type { BackingSource, LibraryEntry, RecordingRef, VideoRef } from './library';
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

/** The saved played bar a song resumes at, and its start in tab seconds; bar 1 at 0 s when it has none or the bar is gone (R8, R9). */
function savedBar(entry: Pick<LibraryEntry, 'position'>, timeline: Timeline): { index: number; tabSeconds: number } {
  const { position } = entry;
  const bar = position === undefined ? undefined : timeline.bars[position];
  return bar ? { index: position as number, tabSeconds: bar.startSeconds } : { index: 0, tabSeconds: 0 };
}

/** Where a reopened song starts, in tab seconds: the start of its saved played bar, or 0 when it has none or the bar is gone (R8, R9). */
export function resumeSeconds(entry: Pick<LibraryEntry, 'position'>, timeline: Timeline): number {
  return savedBar(entry, timeline).tabSeconds;
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

/**
 * The song open in the player, as the app tracks it (KTD7): its tab hash once saved, undefined while the tab is still being
 * saved, and null when it was not saved. Each opened song is its own object, so identity says whether the song changed.
 */
export interface OpenSong {
  tabHash: string | null | undefined;
  /** The tab save's result while `tabHash` is undefined, so a close can wait for the hash (KTD6); absent for a reopened song. */
  readonly hash?: Promise<string | null>;
}

/** Whether the song with this tab hash is the one open, so picking it does nothing (R3). */
export function isOpenSong(song: OpenSong | null, tabHash: string): boolean {
  return !!song && song.tabHash === tabHash;
}

/** Where a reopened song is put, until the clocks that lead take it (KTD4): its saved bar, in tab seconds, for one reopen run. */
export interface PendingResume {
  readonly index: number;
  readonly tabSeconds: number;
  /** The reopen run that set it; a newer run makes it stale. */
  readonly run: number;
}

/** The resume for a reopened song: its saved bar, or bar 1 when it has none or the bar is gone (R8, R9). */
export function resumeFor(entry: Pick<LibraryEntry, 'position'>, timeline: Timeline, run: number): PendingResume {
  return { ...savedBar(entry, timeline), run };
}

/** Whether playback stopped at the end of the song, which saves bar 1 (R7). */
export function atSongEnd(tabSeconds: number, durationSeconds: number): boolean {
  return durationSeconds > 0 && tabSeconds >= durationSeconds - 0.05;
}

/** The position to save for a song stopped at `tabSeconds`: its played bar (repeats expanded), or bar 1 when it stopped at the end (R7). */
export function positionAt(timeline: Timeline, tabSeconds: number): number {
  return atSongEnd(tabSeconds, timeline.durationSeconds) ? 0 : playbackBarIndexAt(timeline, tabSeconds);
}

export interface ParkDeps {
  /** Makes any reopen still running stale. */
  invalidateReopen(): void;
  /** Pauses every clock, the YouTube player's included. */
  pause(): void;
  /** The followed clock's tab time, read after the pause. */
  tabSeconds(): number;
  /** Saves the position to that song, whichever song is open by the time it is written. */
  save(song: OpenSong, index: number): void;
}

/**
 * The first half of leaving a song (KTD1): invalidate any reopen (not from onReopen, whose own run already did), pause every
 * clock, capture the position (KTD8) and save it. On the start screen (`timeline` null) only the invalidate runs. Returns
 * the position saved, or null when none was: the sample, or a tab that was not saved.
 */
export function parkSong(
  state: { fromReopen: boolean; song: OpenSong | null; pending: PendingResume | null; timeline: Timeline | null },
  deps: ParkDeps,
): number | null {
  if (!state.fromReopen) deps.invalidateReopen();
  const { timeline, song, pending } = state;
  if (!timeline) return null;
  deps.pause();
  if (!song || song.tabHash === null) return null;
  let index: number;
  if (pending) {
    // A half-opened song keeps its saved bar (R11).
    index = pending.index;
  } else {
    index = positionAt(timeline, deps.tabSeconds());
  }
  deps.save(song, index);
  return index;
}

/**
 * Leaving for a new file (KTD1): park the open song, open the new one, and release the old one only once the new one has
 * opened. A file that fails to open rejects here and leaves the old song parked, not released.
 */
export async function leaveThenOpen<T>(park: () => void, open: () => T | Promise<T>, release: () => void): Promise<T> {
  park();
  const opened = await open();
  release();
  return opened;
}

export interface ReopenDeps<T> {
  park(): void;
  readTab(tabHash: string): Promise<Uint8Array | null>;
  /** Parses the tab bytes; throws for a tab that cannot be opened. */
  parse(bytes: Uint8Array): T;
  release(): void;
  /** Resolves once the picked song's pending saves have landed; waited for at most SETTLED_CAP_MS. */
  settled(tabHash: string): Promise<void>;
  find(tabHash: string): Promise<LibraryEntry | null>;
  readRecording(ref: RecordingRef): Promise<File | null>;
  /** Whether this reopen is still the latest (R11). */
  isCurrent(): boolean;
}

/** How long a reopen waits for the picked song's pending saves before reading its entry anyway, so a hung save cannot stall switching. */
export const SETTLED_CAP_MS = 3000;

/** Settles when `wait` does, or resolves after `capMs`, whichever comes first. */
async function capped(wait: Promise<void>, capMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([wait, new Promise<void>((resolve) => (timer = setTimeout(resolve, capMs)))]);
  } finally {
    clearTimeout(timer);
  }
}

export type ReopenPrep<T> =
  | { kind: 'stale' }
  | { kind: 'tab-missing' }
  | { kind: 'ready'; bytes: Uint8Array; parsed: T; entry: LibraryEntry; recording: File | null };

/**
 * Everything a reopen does before the restore (KTD1, KTD3): park the open song, read and parse the picked song's tab (a
 * failure stops here with the open song parked, not released; R10), release the open song, wait for the picked song's
 * pending saves (for at most SETTLED_CAP_MS), then read its entry afresh and its recording from that entry. Only the tab bytes, which the hash fixes,
 * are read before the wait. A parse failure rejects.
 */
export async function prepareReopen<T>(target: LibraryEntry, deps: ReopenDeps<T>, settledCapMs = SETTLED_CAP_MS): Promise<ReopenPrep<T>> {
  deps.park();
  const bytes = await deps.readTab(target.tabHash);
  if (!deps.isCurrent()) return { kind: 'stale' };
  if (!bytes) return { kind: 'tab-missing' };
  const parsed = deps.parse(bytes);
  deps.release();
  await capped(Promise.resolve().then(() => deps.settled(target.tabHash)), settledCapMs);
  if (!deps.isCurrent()) return { kind: 'stale' };
  const entry = (await deps.find(target.tabHash)) ?? target;
  if (!deps.isCurrent()) return { kind: 'stale' };
  const recording = entry.recording ? await deps.readRecording(entry.recording) : null;
  if (!deps.isCurrent()) return { kind: 'stale' };
  return { kind: 'ready', bytes, parsed, entry, recording };
}

/**
 * Whether a pause saves the position (KTD5): only when the same song was open when playback started and when it stopped,
 * and no resume is pending, so a pause that crosses a song change never writes.
 */
export function shouldSaveOnPause(whenPlayed: OpenSong | null, whenPaused: OpenSong | null, resumePending: boolean): boolean {
  return whenPlayed !== null && whenPlayed === whenPaused && !resumePending;
}

/** The clocks a pending resume is applied to; stems take it too but are never waited for. */
export type ResumeClock = 'synth' | 'video' | 'recording' | 'stems';

/**
 * The clocks a reopen expects to lead, each of which must take the resume before it clears (KTD4): the synth always, the
 * video when its audio is heard, and the recording when one loads.
 */
export function expectedResumeClocks(steps: readonly RestoreStep[]): ResumeClock[] {
  const clocks: ResumeClock[] = ['synth'];
  const seeded = steps.find((s) => s.kind === 'seed-video');
  const source = steps.find((s) => s.kind === 'select-source');
  // With no saved source the tab opens on the video's own audio.
  if (seeded?.video && (!source || source.source === 'original')) clocks.push('video');
  if (steps.some((s) => s.kind === 'load-recording')) clocks.push('recording');
  return clocks;
}

/** A reopened song's resume, applied to whichever clock leads until every expected one has taken it (KTD4). */
export interface ResumeTracker {
  readonly pending: PendingResume | null;
  start(resume: PendingResume, expected: readonly ResumeClock[]): void;
  /**
   * Seeks a clock to the pending resume while its reopen is current. True when it was applied; a stale resume is dropped.
   * The resume clears once every expected clock has taken it.
   */
  apply(clock: ResumeClock, seek: (tabSeconds: number) => void, isCurrent: (run: number) => boolean): boolean;
  /** The player seeked or played, or the song was left. */
  clear(): void;
}

export function createResumeTracker(): ResumeTracker {
  let pending: PendingResume | null = null;
  let waiting = new Set<ResumeClock>();
  return {
    get pending() {
      return pending;
    },
    start(resume, expected) {
      pending = resume;
      waiting = new Set(expected);
    },
    apply(clock, seek, isCurrent) {
      if (!pending) return false;
      if (!isCurrent(pending.run)) {
        pending = null;
        return false;
      }
      seek(pending.tabSeconds);
      waiting.delete(clock);
      if (waiting.size === 0) pending = null;
      return true;
    },
    clear() {
      pending = null;
      waiting = new Set();
    },
  };
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
