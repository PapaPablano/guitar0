import { describe, expect, it } from 'vitest';
import { SongLibrary, type LibraryEntry, type LibraryIndex, type RecordingRef } from '../../src/app/library';
import {
  createResumeTracker,
  createStemsAutoStart,
  expectedResumeClocks,
  isOpenSong,
  leaveThenOpen,
  parkSong,
  planRestore,
  positionToSave,
  prepareReopen,
  resumeFor,
  shouldSaveOnPause,
  type OpenSong,
  type PendingResume,
  type ReopenDeps,
  RECORDING_MISSING,
  restoreTrack,
  resumeSeconds,
  restoreTuning,
  runRestore,
  seedVideoStore,
  storedVideo,
  tabWithTuning,
  type RestoreStep,
} from '../../src/app/library-restore';
import { takesOverFromVideo } from '../../src/app/youtube-backing';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { UserAudioClock, type AudioLike } from '../../src/audio/user-audio';
import { YoutubeVideoStore, type KeyValueStorage } from '../../src/app/youtube-video-store';
import { tabFingerprint } from '../../src/audio/tab-fingerprint';
import { barSpansOf } from '../../src/alignment/analyze';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { FILE_TUNING, presetById } from '../../src/model/retune';
import { makeTimeline, makeTwoTrackTimeline } from '../helpers/make-timeline';

const recording: RecordingRef = { hash: 'c'.repeat(64), name: 'take.mp3', type: 'audio/mpeg', extension: 'mp3' };

function entryWith(patch: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    tabHash: 'a'.repeat(64),
    title: 'Song',
    fileName: 'song.gp',
    fingerprint: '4:00000000',
    openedAt: 1,
    recording: null,
    video: null,
    source: null,
    trackIndex: 0,
    tuningId: FILE_TUNING,
    ...patch,
  };
}

/** Guitar with notes at 0, and a second track with none. */
const twoTracks = makeTwoTrackTimeline(makeTimeline([{ start: 0, end: 1 }]), makeTimeline([]));
const file = new File(['x'], 'take.mp3', { type: 'audio/mpeg' });
const kinds = (steps: RestoreStep[]) => steps.map((s) => s.kind);

const TWO_TRACKS = String.raw`\title "T" \tempo 100
\track "Guitar" \staff {tabs} \tuning E4 B3 G3 D3 A2 E2
:4 0.6 3.6 5.6 7.6 |
\track "Bass" \staff {tabs} \tuning G2 D2 A1 E1
:4 0.4 3.4 5.4 7.4 |`;

describe('planRestore', () => {
  it('covers AE2: a song with a recording, a video and the video as source restores the tab, then the video, its source, then the recording', () => {
    const entry = entryWith({ recording, video: { videoId: 'abc', offsetSeconds: 1.5 }, source: 'video', trackIndex: 0 });
    const steps = planRestore(entry, twoTracks, file);
    // The source is held before the recording appears, so the recording's arrival cannot take over from the video.
    expect(kinds(steps)).toEqual(['tab', 'seek', 'seed-video', 'select-source', 'load-recording']);
    expect(steps[0]).toEqual({ kind: 'tab', trackIndex: 0, tuningId: FILE_TUNING });
    expect(steps[1]).toEqual({ kind: 'seek', tabSeconds: 0 });
    expect(steps[2]).toEqual({ kind: 'seed-video', video: { videoId: 'abc', offsetSeconds: 1.5 } });
    expect(steps[3]).toEqual({ kind: 'select-source', source: 'original' });
    expect(steps[4]).toEqual({ kind: 'load-recording', file });
  });

  it('selects the recording (the synth side) when that was the last source', () => {
    const steps = planRestore(entryWith({ recording, video: { videoId: 'abc', offsetSeconds: 0 }, source: 'recording' }), twoTracks, file);
    expect(steps.find((s) => s.kind === 'select-source')).toEqual({ kind: 'select-source', source: 'synth' });
  });

  it('seeds "no video" for a song without one, so a video another song left under the same fingerprint is not attached', () => {
    const steps = planRestore(entryWith({ recording }), twoTracks, file);
    expect(kinds(steps)).toEqual(['tab', 'seek', 'seed-video', 'load-recording']);
    expect(steps[2]).toEqual({ kind: 'seed-video', video: null });
  });

  it('shows the R13 note and loads nothing when the stored recording is missing', () => {
    const steps = planRestore(entryWith({ recording }), twoTracks, null);
    expect(kinds(steps)).toEqual(['tab', 'seek', 'seed-video', 'note']);
    expect(steps[3]).toEqual({ kind: 'note', text: RECORDING_MISSING });
  });

  it('shows no note for a song that never had a recording (R11)', () => {
    expect(kinds(planRestore(entryWith(), twoTracks, null))).toEqual(['tab', 'seek', 'seed-video']);
  });

  it('still selects the saved source when the recording is missing', () => {
    const steps = planRestore(entryWith({ recording, video: { videoId: 'abc', offsetSeconds: 0 }, source: 'video' }), twoTracks, null);
    expect(kinds(steps)).toEqual(['tab', 'seek', 'seed-video', 'select-source', 'note']);
  });

  it('carries the resolved track and tuning on the tab step', () => {
    const steps = planRestore(entryWith({ trackIndex: 7, tuningId: 'no-such-tuning' }), twoTracks, null);
    expect(steps[0]).toEqual({ kind: 'tab', trackIndex: 0, tuningId: FILE_TUNING });
  });

  it('keeps the saved tuning on the saved track', () => {
    const steps = planRestore(entryWith({ trackIndex: 0, tuningId: 'half-down' }), twoTracks, null);
    expect(steps[0]).toEqual({ kind: 'tab', trackIndex: 0, tuningId: 'half-down' });
  });

  it('opens a fallback track in its file tuning, not the tuning saved for the old track', () => {
    // Out of range, and a track with no notes: both fall back to track 0.
    expect(planRestore(entryWith({ trackIndex: 7, tuningId: 'half-down' }), twoTracks, null)[0]).toEqual({ kind: 'tab', trackIndex: 0, tuningId: FILE_TUNING });
    expect(planRestore(entryWith({ trackIndex: 1, tuningId: 'half-down' }), twoTracks, null)[0]).toEqual({ kind: 'tab', trackIndex: 0, tuningId: FILE_TUNING });
  });

  it('covers R8: seeks to the start of the saved bar right after the tab opens', () => {
    // makeTimeline: four 2-second bars.
    const steps = planRestore(entryWith({ position: 3 }), twoTracks, null);
    expect(kinds(steps)).toEqual(['tab', 'seek', 'seed-video']);
    expect(steps[1]).toEqual({ kind: 'seek', tabSeconds: 6 });
  });

  it('covers R9: seeks to bar 1 for a song with no saved position or one past the end', () => {
    expect(planRestore(entryWith(), twoTracks, null)[1]).toEqual({ kind: 'seek', tabSeconds: 0 });
    expect(planRestore(entryWith({ position: 99 }), twoTracks, null)[1]).toEqual({ kind: 'seek', tabSeconds: 0 });
  });
});

/** Eight one-bar score bars, bars 4–7 (1-based) repeated once: 12 played bars. */
const REPEATS = String.raw`\title "R" \tempo 120
:4 0.3 0.3 0.3 0.3 | 1.3 1.3 1.3 1.3 | 2.3 2.3 2.3 2.3 | \ro 3.3 3.3 3.3 3.3 | 4.3 4.3 4.3 4.3 | 5.3 5.3 5.3 5.3 | \rc 2 6.3 6.3 6.3 6.3 | 7.3 7.3 7.3 7.3`;

describe('resumeSeconds', () => {
  const timeline = makeTimeline([], 2, 4);

  it("gives the saved bar's start (R8)", () => {
    expect(resumeSeconds(entryWith({ position: 3 }), timeline)).toBe(timeline.bars[3].startSeconds);
    expect(resumeSeconds(entryWith({ position: 0 }), timeline)).toBe(0);
  });

  it('gives 0 for a missing or out-of-range position (R9)', () => {
    expect(resumeSeconds(entryWith(), timeline)).toBe(0);
    expect(resumeSeconds(entryWith({ position: 4 }), timeline)).toBe(0);
    expect(resumeSeconds(entryWith({ position: 99 }), timeline)).toBe(0);
  });

  it('counts played bars with repeats expanded (R7)', () => {
    const played = buildTimeline(loadAlphaTex(REPEATS));
    expect(played.scoreBarCount).toBe(8);
    expect(played.bars).toHaveLength(12);
    // Index 7 is score bar 4 (index 3) on its second pass, and index 11 is past the score's own bar count.
    expect(played.bars[7].scoreBar).toBe(3);
    expect(resumeSeconds(entryWith({ position: 5 }), played)).toBe(played.bars[5].startSeconds);
    expect(resumeSeconds(entryWith({ position: 7 }), played)).toBe(played.bars[7].startSeconds);
    expect(resumeSeconds(entryWith({ position: 7 }), played)).toBeGreaterThan(played.bars[6].startSeconds);
    expect(resumeSeconds(entryWith({ position: 11 }), played)).toBe(played.bars[11].startSeconds);
    expect(resumeSeconds(entryWith({ position: 12 }), played)).toBe(0);
  });

  it('gives 0 for a tab with no bars', () => {
    expect(resumeSeconds(entryWith({ position: 0 }), makeTimeline([], 2, 0))).toBe(0);
  });
});

describe('positionToSave', () => {
  const timeline = makeTimeline([], 2, 4);

  it('saves the played bar the tab time is in (R7)', () => {
    expect(positionToSave(timeline, 0, false)).toBe(0);
    expect(positionToSave(timeline, 5.9, false)).toBe(2);
    expect(positionToSave(timeline, 6, false)).toBe(3);
  });

  it('saves bar 1 at the end of the song (R7)', () => {
    expect(positionToSave(timeline, 7.5, true)).toBe(0);
    expect(positionToSave(timeline, timeline.durationSeconds, true)).toBe(0);
  });

  it('saves bar 1 before the first bar starts or for a tab with no bars', () => {
    expect(positionToSave(timeline, -1, false)).toBe(0);
    expect(positionToSave(makeTimeline([], 2, 0), 3, false)).toBe(0);
  });

  it('counts the second pass through a repeat as a later bar, and round-trips through resumeSeconds', () => {
    const played = buildTimeline(loadAlphaTex(REPEATS));
    const t = played.bars[7].startSeconds + 0.1;
    const index = positionToSave(played, t, false);
    expect(index).toBe(7);
    expect(resumeSeconds(entryWith({ position: index }), played)).toBe(played.bars[7].startSeconds);
  });
});

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('seedVideoStore', () => {
  it("attaches the song's video at its saved offset (R10), even on a machine whose store has never seen it", () => {
    const store = new YoutubeVideoStore(memoryStorage());
    seedVideoStore(store, '4:aa', { videoId: 'vid', offsetSeconds: 2.25 });
    expect(store.videoFor('4:aa')).toBe('vid');
    expect(store.offsetFor('4:aa')).toBe(2.25);
  });

  it('two songs share a fingerprint and only one has a video: reopening the other attaches no video', () => {
    const store = new YoutubeVideoStore(memoryStorage());
    seedVideoStore(store, '4:aa', { videoId: 'vid', offsetSeconds: 1 });
    seedVideoStore(store, '4:aa', null);
    expect(store.videoFor('4:aa')).toBeNull();
    // The offset stays with the video, so reopening the first song finds it again.
    seedVideoStore(store, '4:aa', { videoId: 'vid', offsetSeconds: 1 });
    expect(store.offsetFor('4:aa')).toBe(1);
  });

  it("replaces another song's video under the same fingerprint with this song's", () => {
    const store = new YoutubeVideoStore(memoryStorage());
    seedVideoStore(store, '4:aa', { videoId: 'one', offsetSeconds: 1 });
    seedVideoStore(store, '4:aa', { videoId: 'two', offsetSeconds: -0.5 });
    expect(store.videoFor('4:aa')).toBe('two');
    expect(store.offsetFor('4:aa')).toBe(-0.5);
  });
});

describe('storedVideo', () => {
  it('reads the video and offset the store has for a tab', () => {
    const store = new YoutubeVideoStore(memoryStorage());
    expect(storedVideo(store, '4:aa')).toBeNull();
    store.attach('4:aa', 'vid');
    expect(storedVideo(store, '4:aa')).toEqual({ videoId: 'vid', offsetSeconds: 0 });
    store.saveOffset('4:aa', 1.5);
    expect(storedVideo(store, '4:aa')).toEqual({ videoId: 'vid', offsetSeconds: 1.5 });
    store.detach('4:aa');
    expect(storedVideo(store, '4:aa')).toBeNull();
  });

  it('a video attached before the library existed stays attached when the new song is first reopened', async () => {
    const store = new YoutubeVideoStore(memoryStorage());
    store.attach('4:aa', 'vid');
    store.saveOffset('4:aa', 2.5);
    let data: LibraryIndex = { version: 1, entries: [] };
    const library = new SongLibrary({
      read: async () => ({ index: data, quarantined: false }),
      write: async (index) => void (data = index),
    });
    await library.open({ tabHash: 'a'.repeat(64), title: 'Song', fileName: 'song.gp', fingerprint: '4:aa' }, 1, storedVideo(store, '4:aa'));
    const entry = (await library.find('a'.repeat(64)))!;
    const seed = planRestore(entry, twoTracks, null).find((s) => s.kind === 'seed-video')!;
    seedVideoStore(store, '4:aa', seed.kind === 'seed-video' ? seed.video : null);
    expect(store.videoFor('4:aa')).toBe('vid');
    expect(store.offsetFor('4:aa')).toBe(2.5);
  });
});

describe('restoreTrack', () => {
  it('keeps a stored track that exists and has notes', () => {
    const both = makeTwoTrackTimeline(makeTimeline([{ start: 0, end: 1 }]), makeTimeline([{ start: 0, end: 1 }]));
    expect(restoreTrack(1, both)).toBe(1);
  });

  it('falls back to the first playable track when the stored index is beyond the track count', () => {
    expect(restoreTrack(5, twoTracks)).toBe(0);
  });

  it('falls back to the first playable track when the stored track has no notes', () => {
    expect(restoreTrack(1, twoTracks)).toBe(0);
  });
});

describe('restoreTuning', () => {
  it('keeps a known preset and the file tuning', () => {
    expect(restoreTuning('half-down')).toBe('half-down');
    expect(restoreTuning(FILE_TUNING)).toBe(FILE_TUNING);
  });

  it('falls back to the file tuning for an unknown id', () => {
    expect(restoreTuning('gone')).toBe(FILE_TUNING);
  });
});

describe('tabWithTuning', () => {
  it('applies a stored tuning before the timeline is built, without changing the fingerprint', () => {
    const score = loadAlphaTex(TWO_TRACKS);
    const before = tabFingerprint(barSpansOf(buildTimeline(score)));
    const { timeline, written } = tabWithTuning(score, 0, 'half-down');
    expect(timeline.tracks[0].tuning).toEqual(presetById('half-down')!.tuning);
    expect(tabFingerprint(barSpansOf(timeline))).toBe(before);
    // What the file wrote is kept, so a later choice still starts from the file.
    expect(written[0][0]).toEqual(presetById('standard')!.tuning);
  });

  it('leaves the file as written for the file tuning', () => {
    const score = loadAlphaTex(TWO_TRACKS);
    const { timeline } = tabWithTuning(score, 0, FILE_TUNING);
    expect(timeline.tracks[0].tuning).toEqual(presetById('standard')!.tuning);
  });
});

describe('runRestore', () => {
  const steps: RestoreStep[] = [
    { kind: 'tab', trackIndex: 0, tuningId: FILE_TUNING },
    { kind: 'seed-video', video: null },
    { kind: 'load-recording', file },
  ];

  it('runs every step in order and reports completion', async () => {
    const ran: string[] = [];
    const done = await runRestore(steps, (s) => void ran.push(s.kind), () => true);
    expect(done).toBe(true);
    expect(ran).toEqual(['tab', 'seed-video', 'load-recording']);
  });

  it('stops the remaining steps when another file or song opens between steps (R15)', async () => {
    let current = true;
    const ran: string[] = [];
    const done = await runRestore(
      steps,
      async (s) => {
        ran.push(s.kind);
        if (s.kind === 'seed-video') current = false;
      },
      () => current,
    );
    expect(done).toBe(false);
    expect(ran).toEqual(['tab', 'seed-video']);
  });

  it('stops when the token changes while a step is still running', async () => {
    let current = true;
    const ran: string[] = [];
    const done = await runRestore(
      [...steps, { kind: 'select-source', source: 'original' }],
      async (s) => {
        ran.push(s.kind);
        if (s.kind === 'load-recording') {
          await Promise.resolve();
          current = false;
        }
      },
      () => current,
    );
    expect(done).toBe(false);
    expect(ran).not.toContain('select-source');
  });

  it('runs nothing when the reopen is already stale', async () => {
    const ran: string[] = [];
    expect(await runRestore(steps, (s) => void ran.push(s.kind), () => false)).toBe(false);
    expect(ran).toEqual([]);
  });

  it('runs the tab, video and source steps without yielding, so they all happen before the next render', async () => {
    const order: string[] = [];
    const flow = runRestore(steps, (s) => void order.push(s.kind), () => true);
    order.push('yielded');
    await flow;
    expect(order.indexOf('seed-video')).toBeLessThan(order.indexOf('yielded'));
  });

  it('hands the recording step the state the tab step just set, with no render in between (KTD5)', async () => {
    // Stands in for App's live ref: startSession writes the new session there, onLoadRecording reads its duration back.
    const live = { durationSeconds: 0 };
    let loadedWith = -1;
    await runRestore(
      steps,
      async (s) => {
        if (s.kind === 'tab') live.durationSeconds = twoTracks.durationSeconds;
        if (s.kind === 'load-recording') loadedWith = live.durationSeconds;
      },
      () => true,
    );
    expect(loadedWith).toBe(twoTracks.durationSeconds);
    expect(loadedWith).not.toBe(0);
  });
});

describe('takesOverFromVideo', () => {
  it('covers AE2: with the player ready before the recording loads, a reopened song on the video keeps the video', () => {
    expect(takesOverFromVideo({ videoReady: true, ownLoaded: true, source: 'original', restoring: true })).toBe(false);
  });

  it('still lets a recording take over from the video when the player loads one themselves', () => {
    expect(takesOverFromVideo({ videoReady: true, ownLoaded: true, source: 'original', restoring: false })).toBe(true);
  });

  it('never takes over without a ready video, with the synth side chosen, or when the recording went away', () => {
    expect(takesOverFromVideo({ videoReady: false, ownLoaded: true, source: 'original', restoring: false })).toBe(false);
    expect(takesOverFromVideo({ videoReady: true, ownLoaded: true, source: 'synth', restoring: false })).toBe(false);
    expect(takesOverFromVideo({ videoReady: true, ownLoaded: false, source: 'original', restoring: false })).toBe(false);
  });
});

describe('createStemsAutoStart', () => {
  const ready = { engineReady: true, hasSaved: true, active: false, busy: false };

  it('starts the reopened recording\'s saved stems on the first ready status, once', () => {
    const auto = createStemsAutoStart();
    auto.arm(file);
    expect(auto.take({ ...ready, recording: file, engineReady: false })).toBe(false);
    expect(auto.take({ ...ready, recording: file })).toBe(true);
    expect(auto.take({ ...ready, recording: file })).toBe(false);
  });

  it('waits for the saved stems to be found once the engine is ready', () => {
    const auto = createStemsAutoStart();
    auto.arm(file);
    expect(auto.take({ ...ready, recording: file, hasSaved: false })).toBe(false);
    expect(auto.take({ ...ready, recording: file })).toBe(true);
  });

  it('does not start after a manual mix change', () => {
    const auto = createStemsAutoStart();
    auto.arm(file);
    auto.cancel();
    expect(auto.take({ ...ready, recording: file })).toBe(false);
  });

  it('does not start for another recording, or when nothing was reopened', () => {
    const auto = createStemsAutoStart();
    expect(auto.take({ ...ready, recording: file })).toBe(false);
    auto.arm(file);
    const other = new File(['y'], 'other.mp3');
    expect(auto.take({ ...ready, recording: other })).toBe(false);
    // Another recording loaded replaces the reopened one for good.
    expect(auto.take({ ...ready, recording: file })).toBe(false);
  });

  it('does not start while stems already play or a separation runs', () => {
    const auto = createStemsAutoStart();
    auto.arm(file);
    expect(auto.take({ ...ready, recording: file, active: true })).toBe(false);
    expect(auto.take({ ...ready, recording: file, busy: true })).toBe(false);
  });
});

/** A recording element that only moves when told to. */
function fakeAudio(): AudioLike & { paused: boolean; ended: boolean; duration: number } {
  return {
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    paused: true,
    ended: false,
    duration: 200,
    async play() {
      this.paused = false;
    },
    pause() {
      this.paused = true;
    },
  };
}

/** Forty 2-second bars. */
const long = makeTimeline([], 2, 40);
const songA: OpenSong = { tabHash: 'a'.repeat(64) };

describe('parkSong', () => {
  function deps(log: string[], tabSeconds = 0) {
    return {
      invalidateReopen: () => void log.push('invalidate'),
      pause: () => void log.push('pause'),
      tabSeconds: () => {
        log.push('capture');
        return tabSeconds;
      },
      save: (song: OpenSong, index: number) => void log.push(`save ${song.tabHash === undefined ? 'saving' : song.tabHash?.slice(0, 1)} ${index}`),
    };
  }

  it('invalidates any reopen, pauses, captures the played bar, then saves it to that song (KTD1)', () => {
    const log: string[] = [];
    const index = parkSong({ fromReopen: false, song: songA, pending: null, timeline: long }, deps(log, long.bars[36].startSeconds + 0.5));
    expect(index).toBe(36);
    expect(log).toEqual(['invalidate', 'pause', 'capture', 'save a 36']);
  });

  it('skips the invalidate when called from onReopen, whose own run already superseded earlier ones', () => {
    const log: string[] = [];
    parkSong({ fromReopen: true, song: songA, pending: null, timeline: long }, deps(log, 3));
    expect(log).toEqual(['pause', 'capture', 'save a 1']);
  });

  it('covers R11: a song left while its resume is pending saves the pending bar, not where its clock happens to be', () => {
    const log: string[] = [];
    const pending: PendingResume = { index: 36, tabSeconds: long.bars[36].startSeconds, run: 1 };
    expect(parkSong({ fromReopen: true, song: songA, pending, timeline: long }, deps(log, 0))).toBe(36);
    expect(log).toEqual(['pause', 'save a 36']);
  });

  it('saves bar 1 at the end of the song (R7)', () => {
    const log: string[] = [];
    expect(parkSong({ fromReopen: false, song: songA, pending: null, timeline: long }, deps(log, long.durationSeconds))).toBe(0);
    expect(log).toContain('save a 0');
  });

  it('pauses but saves nothing for the sample or a tab that was not saved (KTD8)', () => {
    const sample: string[] = [];
    expect(parkSong({ fromReopen: false, song: null, pending: null, timeline: long }, deps(sample))).toBeNull();
    expect(sample).toEqual(['invalidate', 'pause']);
    const unsaved: string[] = [];
    parkSong({ fromReopen: false, song: { tabHash: null }, pending: null, timeline: long }, deps(unsaved));
    expect(unsaved).toEqual(['invalidate', 'pause']);
  });

  it('saves to a song whose tab is still being saved; the session sends it to that song once it is', () => {
    const log: string[] = [];
    parkSong({ fromReopen: false, song: { tabHash: undefined }, pending: null, timeline: long }, deps(log, 5));
    expect(log).toEqual(['invalidate', 'pause', 'capture', 'save saving 2']);
  });

  it('only invalidates on the start screen, where no song is open', () => {
    const log: string[] = [];
    expect(parkSong({ fromReopen: false, song: null, pending: null, timeline: null }, deps(log))).toBeNull();
    expect(log).toEqual(['invalidate']);
  });
});

describe('leaveThenOpen', () => {
  it('parks the song, opens the new one, and only then releases the old one (KTD1)', async () => {
    const log: string[] = [];
    const opened = await leaveThenOpen(
      () => void log.push('park'),
      () => {
        log.push('parse');
        return 'B';
      },
      () => void log.push('release'),
    );
    expect(opened).toBe('B');
    expect(log).toEqual(['park', 'parse', 'release']);
  });

  it('leaves the song parked, not released, when the new file fails to parse', async () => {
    const log: string[] = [];
    await expect(
      leaveThenOpen(
        () => void log.push('park'),
        async () => {
          throw new Error('Not a tab');
        },
        () => void log.push('release'),
      ),
    ).rejects.toThrow('Not a tab');
    expect(log).toEqual(['park']);
  });
});

describe('prepareReopen', () => {
  const freshRecording: RecordingRef = { ...recording, hash: 'd'.repeat(64), name: 'newer.mp3' };
  const target = entryWith({ tabHash: 'b'.repeat(64), recording });
  const fresh = { ...target, recording: freshRecording, position: 36 };

  function deps(log: string[], patch: Partial<ReopenDeps<{ parsed: number }>> = {}): ReopenDeps<{ parsed: number }> {
    return {
      park: () => void log.push('park'),
      readTab: async () => {
        log.push('read-tab');
        return new Uint8Array([1]);
      },
      parse: (bytes) => {
        log.push('parse');
        return { parsed: bytes.length };
      },
      release: () => void log.push('release'),
      settled: async () => void log.push('settled'),
      find: async () => {
        log.push('find');
        return fresh;
      },
      readRecording: async (ref) => {
        log.push(`read-recording ${ref.name}`);
        return file;
      },
      isCurrent: () => true,
      ...patch,
    };
  }

  it("parks A, reads B's tab, releases A, waits for B's saves, then reads B's recording from the fresh entry (KTD3)", async () => {
    const log: string[] = [];
    const result = await prepareReopen(target, deps(log));
    expect(log).toEqual(['park', 'read-tab', 'parse', 'release', 'settled', 'find', 'read-recording newer.mp3']);
    expect(result).toEqual({ kind: 'ready', bytes: new Uint8Array([1]), parsed: { parsed: 1 }, entry: fresh, recording: file });
  });

  it("covers AE4, R10: a tab that can't be read leaves A parked and not released", async () => {
    const log: string[] = [];
    const readTab = async () => {
      log.push('read-tab');
      return null;
    };
    expect(await prepareReopen(target, deps(log, { readTab }))).toEqual({ kind: 'tab-missing' });
    expect(log).toEqual(['park', 'read-tab']);
  });

  it('leaves A parked and not released when the stored tab fails to parse', async () => {
    const log: string[] = [];
    const parse = () => {
      throw new Error('Corrupt');
    };
    await expect(prepareReopen(target, deps(log, { parse }))).rejects.toThrow('Corrupt');
    expect(log).toEqual(['park', 'read-tab']);
  });

  it('covers R11: a reopen superseded while reading releases nothing and reads no further', async () => {
    const log: string[] = [];
    let current = true;
    const readTab = async () => {
      log.push('read-tab');
      current = false;
      return new Uint8Array([1]);
    };
    expect(await prepareReopen(target, deps(log, { readTab, isCurrent: () => current }))).toEqual({ kind: 'stale' });
    expect(log).toEqual(['park', 'read-tab']);
  });

  it('stops before reading the recording when superseded while waiting for saves', async () => {
    const log: string[] = [];
    let current = true;
    const settled = async () => {
      log.push('settled');
      current = false;
    };
    expect(await prepareReopen(target, deps(log, { settled, isCurrent: () => current }))).toEqual({ kind: 'stale' });
    expect(log.some((l) => l.startsWith('read-recording'))).toBe(false);
  });

  it('gives no recording for a song without one, and falls back to the picked entry if the library no longer has it', async () => {
    const log: string[] = [];
    const bare = entryWith({ tabHash: 'b'.repeat(64) });
    const result = await prepareReopen(bare, deps(log, { find: async () => null }));
    expect(result).toMatchObject({ kind: 'ready', entry: bare, recording: null });
    expect(log.some((l) => l.startsWith('read-recording'))).toBe(false);
  });
});

describe('isOpenSong', () => {
  it('covers R3: picking the song already open is recognised, so nothing happens', () => {
    expect(isOpenSong(songA, 'a'.repeat(64))).toBe(true);
    expect(isOpenSong(songA, 'b'.repeat(64))).toBe(false);
    expect(isOpenSong(null, 'a'.repeat(64))).toBe(false);
    expect(isOpenSong({ tabHash: null }, 'a'.repeat(64))).toBe(false);
  });
});

describe('shouldSaveOnPause', () => {
  it('saves when the same song was open when playback started and stopped, with no resume pending (KTD5)', () => {
    expect(shouldSaveOnPause(songA, songA, false)).toBe(true);
  });

  it('does not save when the open song changed between play and pause', () => {
    expect(shouldSaveOnPause(songA, { tabHash: 'a'.repeat(64) }, false)).toBe(false);
    expect(shouldSaveOnPause(songA, null, false)).toBe(false);
    expect(shouldSaveOnPause(null, songA, false)).toBe(false);
  });

  it('does not save while a resume is pending', () => {
    expect(shouldSaveOnPause(songA, songA, true)).toBe(false);
  });
});

describe('resumeFor', () => {
  it('covers AE1: a song saved at bar index 36 resumes at that bar, the same seconds the seek step and the recording start use', () => {
    const entry = entryWith({ position: 36 });
    const steps = planRestore(entry, long, file);
    const resume = resumeFor(entry, long, 7);
    expect(resume).toEqual({ index: 36, tabSeconds: long.bars[36].startSeconds, run: 7 });
    expect(steps[1]).toEqual({ kind: 'seek', tabSeconds: resume.tabSeconds });
  });

  it('gives bar 1 for a missing or out-of-range position (R9)', () => {
    expect(resumeFor(entryWith(), long, 1)).toEqual({ index: 0, tabSeconds: 0, run: 1 });
    expect(resumeFor(entryWith({ position: 40 }), long, 1)).toEqual({ index: 0, tabSeconds: 0, run: 1 });
  });
});

describe('expectedResumeClocks', () => {
  it('expects the synth, the video when its audio is heard, and the recording when one loads (KTD4)', () => {
    const video = { videoId: 'abc', offsetSeconds: 0 };
    expect(expectedResumeClocks(planRestore(entryWith(), long, null))).toEqual(['synth']);
    expect(expectedResumeClocks(planRestore(entryWith({ video }), long, null))).toEqual(['synth', 'video']);
    expect(expectedResumeClocks(planRestore(entryWith({ video, source: 'video', recording }), long, file))).toEqual(['synth', 'video', 'recording']);
    // With the recording as the saved source, the video is parked and never leads.
    expect(expectedResumeClocks(planRestore(entryWith({ video, source: 'recording', recording }), long, file))).toEqual(['synth', 'recording']);
    // A missing recording loads nothing.
    expect(expectedResumeClocks(planRestore(entryWith({ recording }), long, null))).toEqual(['synth']);
  });
});

describe('createResumeTracker', () => {
  const at36: PendingResume = { index: 36, tabSeconds: long.bars[36].startSeconds, run: 1 };
  const current = (run: number) => run === 1;

  it('applies the pending resume to each clock that takes it, and clears once the last expected clock has (KTD4)', () => {
    const tracker = createResumeTracker();
    tracker.start(at36, ['synth', 'recording']);
    const seeks: string[] = [];
    expect(tracker.apply('synth', (s) => void seeks.push(`synth ${s}`), current)).toBe(true);
    expect(tracker.pending).toEqual(at36);
    expect(tracker.apply('recording', (s) => void seeks.push(`recording ${s}`), current)).toBe(true);
    expect(seeks).toEqual([`synth ${at36.tabSeconds}`, `recording ${at36.tabSeconds}`]);
    expect(tracker.pending).toBeNull();
    expect(tracker.apply('synth', () => void seeks.push('late'), current)).toBe(false);
    expect(seeks).not.toContain('late');
  });

  it('gives a video clock that takes over before the sound is ready the pending resume, and still waits for the synth', () => {
    const tracker = createResumeTracker();
    tracker.start(at36, ['synth', 'video']);
    let video = -1;
    tracker.apply('video', (s) => void (video = s), current);
    expect(video).toBe(at36.tabSeconds);
    expect(tracker.pending).toEqual(at36);
    tracker.apply('synth', () => undefined, current);
    expect(tracker.pending).toBeNull();
  });

  it('gives stems that take over the resume without counting them as an expected clock', () => {
    const tracker = createResumeTracker();
    tracker.start(at36, ['synth']);
    let stems = -1;
    tracker.apply('stems', (s) => void (stems = s), current);
    expect(stems).toBe(at36.tabSeconds);
    expect(tracker.pending).toEqual(at36);
  });

  it('clears on a user seek or play', () => {
    const tracker = createResumeTracker();
    tracker.start(at36, ['synth']);
    tracker.clear();
    expect(tracker.pending).toBeNull();
    let seeked = false;
    expect(tracker.apply('synth', () => void (seeked = true), current)).toBe(false);
    expect(seeked).toBe(false);
  });

  it('covers R11: a superseded reopen seeks nothing and its resume is dropped', () => {
    const tracker = createResumeTracker();
    tracker.start(at36, ['synth']);
    let seeked = false;
    expect(tracker.apply('synth', () => void (seeked = true), () => false)).toBe(false);
    expect(seeked).toBe(false);
    expect(tracker.pending).toBeNull();
  });

  it("re-applies after the saved alignment (2 s offset) lands, so the recording clock is at bars[36]'s start", () => {
    const clock = new UserAudioClock(fakeAudio(), long.durationSeconds);
    const tracker = createResumeTracker();
    tracker.start(at36, ['recording']);
    // onLoadRecording seeks to the resume before the alignment is known.
    clock.seek(at36.tabSeconds);
    // restoreProfile then applies the saved alignment; the recording keeps its place, so tab time drifts by the offset.
    clock.setAlignment(AlignmentMap.fromOffset(2));
    expect(clock.time()).toBeCloseTo(at36.tabSeconds - 2, 6);
    tracker.apply('recording', (s) => clock.seek(s), current);
    expect(clock.time()).toBeCloseTo(long.bars[36].startSeconds, 6);
  });

  it('covers AE3: with a hold before bar 36 the resume is in tab seconds, and the alignment maps it to recording time', () => {
    const el = fakeAudio();
    const clock = new UserAudioClock(el, long.durationSeconds);
    const tracker = createResumeTracker();
    tracker.start(at36, ['recording']);
    clock.seek(at36.tabSeconds);
    clock.setAlignment(AlignmentMap.of(0.5, [{ at: long.bars[10].startSeconds, length: 3 }]));
    tracker.apply('recording', (s) => clock.seek(s), current);
    expect(clock.time()).toBeCloseTo(long.bars[36].startSeconds, 6);
    expect(el.currentTime).toBeCloseTo(long.bars[36].startSeconds + 0.5 + 3, 6);
  });
});
