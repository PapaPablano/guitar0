import { describe, expect, it } from 'vitest';
import { SongLibrary, type LibraryEntry, type LibraryIndex, type RecordingRef } from '../../src/app/library';
import {
  createStemsAutoStart,
  planRestore,
  RECORDING_MISSING,
  restoreTrack,
  restoreTuning,
  runRestore,
  seedVideoStore,
  storedVideo,
  tabWithTuning,
  type RestoreStep,
} from '../../src/app/library-restore';
import { takesOverFromVideo } from '../../src/app/youtube-backing';
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
    expect(kinds(steps)).toEqual(['tab', 'seed-video', 'select-source', 'load-recording']);
    expect(steps[0]).toEqual({ kind: 'tab', trackIndex: 0, tuningId: FILE_TUNING });
    expect(steps[1]).toEqual({ kind: 'seed-video', video: { videoId: 'abc', offsetSeconds: 1.5 } });
    expect(steps[2]).toEqual({ kind: 'select-source', source: 'original' });
    expect(steps[3]).toEqual({ kind: 'load-recording', file });
  });

  it('selects the recording (the synth side) when that was the last source', () => {
    const steps = planRestore(entryWith({ recording, video: { videoId: 'abc', offsetSeconds: 0 }, source: 'recording' }), twoTracks, file);
    expect(steps.find((s) => s.kind === 'select-source')).toEqual({ kind: 'select-source', source: 'synth' });
  });

  it('seeds "no video" for a song without one, so a video another song left under the same fingerprint is not attached', () => {
    const steps = planRestore(entryWith({ recording }), twoTracks, file);
    expect(kinds(steps)).toEqual(['tab', 'seed-video', 'load-recording']);
    expect(steps[1]).toEqual({ kind: 'seed-video', video: null });
  });

  it('shows the R13 note and loads nothing when the stored recording is missing', () => {
    const steps = planRestore(entryWith({ recording }), twoTracks, null);
    expect(kinds(steps)).toEqual(['tab', 'seed-video', 'note']);
    expect(steps[2]).toEqual({ kind: 'note', text: RECORDING_MISSING });
  });

  it('shows no note for a song that never had a recording (R11)', () => {
    expect(kinds(planRestore(entryWith(), twoTracks, null))).toEqual(['tab', 'seed-video']);
  });

  it('still selects the saved source when the recording is missing', () => {
    const steps = planRestore(entryWith({ recording, video: { videoId: 'abc', offsetSeconds: 0 }, source: 'video' }), twoTracks, null);
    expect(kinds(steps)).toEqual(['tab', 'seed-video', 'select-source', 'note']);
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
