import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Clock } from '../audio/clock';
import { createSynthSession, type SynthClock } from '../audio/synth-bridge';
import { loadUserAudio, type UserAudioClock } from '../audio/user-audio';
import type { model as AlphaModel } from '@coderline/alphatab';
import { buildTimeline, loadAlphaTex } from '../model/alphatab-adapter';
import { applyFileTuning, captureTunings, type WrittenTunings } from '../model/file-tuning';
import type { Timeline } from '../model/score';
import { getStripLayout, scoreBarStartSeconds, stripBarFor, type LoopBars } from '../render/tab-strip';
import { DropZone } from './DropZone';
import { LoopControls } from './LoopControls';
import { decodeUserRecording } from '../export/audio';
import { renderStemMix } from '../export/stem-audio';
import { initialMix, type MixState } from '../audio/mix-gains';
import { ExportDialog } from './ExportDialog';
import { Notices } from './Notices';
import { OffsetSlider } from './OffsetSlider';
import { clampOffset } from '../audio/offset-range';
import { PROFILE_VERSION, type ProfileStore } from '../audio/recording-profile';
import { WebProfileStore } from '../audio/profile-store-web';
import { shellProfileStore } from '../stems/profile-store-shell';
import { hashFile } from '../stems/file-hash';
import { createRunGuard } from '../stems/run-guard';
import { isDesktop } from './desktop';
import { createDebouncer, DEBOUNCE_MS, decideRestore, fetchProfile } from './restore-profile';
import { StemPanel, type ActiveStems } from './StemPanel';
import { SAMPLE_ALPHATEX } from './sample';
import { Stage } from './Stage';
import { TrackPicker } from './TrackPicker';
import { Transport } from './Transport';
import type { LabelMode } from '../render/fretboard';
import { initialViewState, ViewControls, type BottomView } from './ViewControls';
import { interpretKey, seekByBar } from './navigation';
import { firstPlayableTrack, openTabBytes } from './open-file';
import { songsterrLinkForSong } from './songsterr';
import { assessSupport, readSupportEnvironment } from './support';
import { FILE_TUNING, presetById, retuneTimeline } from '../model/retune';
import { TuningPicker } from './TuningPicker';
import { FileTuningPicker } from './FileTuningPicker';
import { WRITTEN } from './file-tuning-options';
import './app.css';

const SOUND_FONT_URL = './soundfont/sonivox.sf3';

type AudioState = { status: 'loading'; progress: number } | { status: 'ready' } | { status: 'failed'; message: string };

interface Session {
  timeline: Timeline;
  score: AlphaModel.Score;
  clock: SynthClock;
  /** Every staff's open strings as the file wrote them, so a tuning choice always starts from the file. */
  written: WrittenTunings;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tempoPercent, setTempoPercent] = useState(100);
  const [loop, setLoop] = useState<LoopBars | null>(null);
  const [loopOn, setLoopOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [audio, setAudio] = useState<AudioState>({ status: 'loading', progress: 0 });
  const support = useMemo(() => assessSupport(readSupportEnvironment()), []);
  const [userClock, setUserClock] = useState<UserAudioClock | null>(null);
  const [offset, setOffset] = useState(0);
  const [stems, setStems] = useState<ActiveStems | null>(null);
  const [mix, setMix] = useState<MixState>(() => initialMix());
  const [userAudioError, setUserAudioError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [bottomView, setBottomView] = useState<BottomView>(() => initialViewState().bottomView);
  const [lookahead, setLookahead] = useState(() => initialViewState().lookahead);
  const [labelMode, setLabelMode] = useState<LabelMode>(() => initialViewState().labelMode);
  const [tuningId, setTuningId] = useState(FILE_TUNING);
  const lastShown = useRef(-1);
  const playingRef = useRef(false);
  /** Bumped whenever the session or its sound connection is replaced, so late results can be ignored. */
  const sessionToken = useRef(0);
  const userClockRef = useRef<UserAudioClock | null>(null);
  const stemsRef = useRef<ActiveStems | null>(null);
  /** The newest settings, for activateStems, which a separation calls minutes after it was started. */
  const live = useRef({ offset: 0, tempoPercent: 100, mix: initialMix(), userClock: null as UserAudioClock | null, session: null as Session | null });

  /** Where per-recording offset and mix are remembered: a shell file on the desktop, browser storage on the web. */
  const profileStore = useMemo<ProfileStore>(() => (isDesktop() ? shellProfileStore : new WebProfileStore()), []);
  /** Names the recording whose profile lookup is in flight; any newer load or removal makes it stale. */
  const profileRuns = useRef(createRunGuard());
  /** Content hash of the loaded recording, once known; null means nothing is restored or saved for it. */
  const profileHash = useRef<string | null>(null);
  /** True once the user has moved the offset since this recording loaded (KTD12). */
  const offsetMoved = useRef(false);
  /** True once the user has changed the mix since this recording loaded; a restore then leaves the mix alone. */
  const mixMoved = useRef(false);
  /** The mix to remember with the offset; desktop only, set by a restore or a user change. */
  const profileMix = useRef<MixState | undefined>(undefined);
  const profileSaver = useRef<ReturnType<typeof createDebouncer<{ hash: string; offset: number; mix?: MixState }>> | null>(null);
  if (!profileSaver.current) {
    profileSaver.current = createDebouncer(DEBOUNCE_MS, ({ hash, offset, mix }) => {
      void profileStore.save(hash, mix ? { version: PROFILE_VERSION, offset, mix } : { version: PROFILE_VERSION, offset });
    });
  }

  /** Queues a save of the current offset (and desktop mix) for the loaded recording. Loop and tempo are never saved (R19). */
  function scheduleProfileSave(offsetSeconds: number) {
    const hash = profileHash.current;
    if (hash) profileSaver.current?.push({ hash, offset: offsetSeconds, mix: profileMix.current });
  }

  // Do not lose the last change when the page closes.
  useEffect(() => {
    const flush = () => profileSaver.current?.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  /** Forgets the loaded recording's profile state, saving any pending change for it first. */
  function resetProfile() {
    profileSaver.current?.flush();
    profileRuns.current.invalidate();
    profileHash.current = null;
    offsetMoved.current = false;
    mixMoved.current = false;
    profileMix.current = undefined;
    setOffset(0);
    setMix(initialMix());
  }

  /** Looks up the recording's profile and applies it unless the user or another load got there first (KTD12). */
  async function restoreProfile(file: File, clockForLoad: UserAudioClock) {
    const run = profileRuns.current.begin();
    const { hash, profile } = await fetchProfile(() => hashFile(file), profileStore);
    if (!profileRuns.current.isCurrent(run)) return;
    profileHash.current = hash;
    const plan = decideRestore(
      {
        stillLoaded: userClockRef.current === clockForLoad,
        offsetMoved: offsetMoved.current,
        mixMoved: mixMoved.current,
        desktop: isDesktop(),
      },
      profile,
    );
    if (plan?.offset !== undefined) {
      clockForLoad.setOffset(plan.offset);
      stemsRef.current?.clock.setOffset(plan.offset);
      setOffset(plan.offset);
      live.current.offset = plan.offset;
    }
    if (plan?.mix) {
      profileMix.current = plan.mix;
      live.current.mix = plan.mix;
      setMix(plan.mix);
      stemsRef.current?.clock.setMix(plan.mix);
    }
    // Something the user changed before the hash resolved: remember it, alongside whatever was restored.
    if (hash && userClockRef.current === clockForLoad && (offsetMoved.current || mixMoved.current)) {
      scheduleProfileSave(live.current.offset);
    }
  }

  function connectAudio(score: AlphaModel.Score, timelineToPlay: Timeline) {
    sessionToken.current += 1;
    const token = sessionToken.current;
    const isCurrent = () => token === sessionToken.current;
    setAudio({ status: 'loading', progress: 0 });
    const synth = createSynthSession(score, timelineToPlay.durationSeconds, timelineToPlay.tempoMap, {
      soundFontUrl: SOUND_FONT_URL,
      onProgress: (progress) => {
        if (isCurrent()) setAudio((a) => (a.status === 'loading' ? { status: 'loading', progress } : a));
      },
    });
    synth.ready.then(
      () => isCurrent() && setAudio({ status: 'ready' }),
      (e: unknown) =>
        isCurrent() &&
        setAudio({ status: 'failed', message: e instanceof Error ? e.message : 'The sound could not be loaded.' }),
    );
    return synth.clock;
  }

  /** Replaces the recording clock, disposing the previous one. */
  function replaceUserClock(next: UserAudioClock | null) {
    stemsRef.current?.clock.dispose();
    stemsRef.current = null;
    setStems(null);
    userClockRef.current?.dispose();
    userClockRef.current = next;
    setUserClock(next);
  }

  function startSession(score: AlphaModel.Score, timeline: Timeline) {
    session?.clock.dispose();
    replaceUserClock(null);
    resetProfile();
    setUserAudioError(null);
    setSession({ timeline, score, clock: connectAudio(score, timeline), written: captureTunings(score) });
    setTrackIndex(firstPlayableTrack(timeline));
    setBottomView(initialViewState().bottomView);
    setLookahead(initialViewState().lookahead);
    setLabelMode(initialViewState().labelMode);
    setTuningId(FILE_TUNING);
    setTempoPercent(100);
    setLoop(null);
    setLoopOn(false);
    playingRef.current = false;
    setPlaying(false);
    setSeconds(0);
    setError(null);
  }

  async function onFile(file: File) {
    setLoading(true);
    try {
      const { score, timeline } = openTabBytes(new Uint8Array(await file.arrayBuffer()));
      startSession(score, timeline);
    } catch (e) {
      // keep the previous session; just report the problem
      setError(e instanceof Error && e.message ? e.message : 'Could not open that file.');
    } finally {
      setLoading(false);
    }
  }

  function onSample() {
    try {
      const score = loadAlphaTex(SAMPLE_ALPHATEX);
      startSession(score, buildTimeline(score));
    } catch {
      setError('Could not load the sample.');
    }
  }

  /** Switches between playing the stem mix and the plain recording, keeping the position. */
  function activateStems(next: ActiveStems | null) {
    const { offset, tempoPercent, mix, userClock, session } = live.current;
    const current = stemsRef.current;
    const position = current?.clock.time() ?? userClock?.time() ?? session?.clock.time() ?? 0;
    current?.clock.dispose();
    stemsRef.current = next;
    setStems(next);
    if (next) {
      userClock?.pause();
      session?.clock.pause();
      next.clock.setRate(tempoPercent / 100);
      next.clock.setOffset(offset);
      next.clock.setMix(mix);
      next.clock.seek(position);
    } else {
      (userClock ?? session?.clock)?.seek(position);
    }
  }

  live.current = { offset, tempoPercent, mix, userClock, session };

  const clock: Clock | undefined = stems?.clock ?? userClock ?? session?.clock;
  const sourceTimeline = session?.timeline;
  // The tab is shown in the chosen tuning; the sound always comes from the file.
  const timeline = useMemo(() => {
    const preset = presetById(tuningId);
    return sourceTimeline && preset ? retuneTimeline(sourceTimeline, trackIndex, preset.tuning) : sourceTimeline;
  }, [sourceTimeline, trackIndex, tuningId]);

  // Apply the loop to the clock whenever the loop or its switch changes.
  useEffect(() => {
    if (!clock || !timeline) return;
    if (!loop || !loopOn) {
      clock.setLoop(null);
      return;
    }
    const layout = getStripLayout(timeline, trackIndex, 1, 1);
    const first = stripBarFor(layout, loop.startBar);
    const last = stripBarFor(layout, loop.endBar);
    if (first && last) {
      clock.setLoop({
        start: first.playback.startSeconds,
        end: last.playback.endSeconds,
        startTick: first.playback.startTick,
        endTick: last.playback.endTick,
      });
    }
  }, [clock, timeline, trackIndex, loop, loopOn]);

  const audioReady = audio.status === 'ready' || userClock !== null || stems !== null;
  useEffect(() => {
    if (audioReady) clock?.setRate(tempoPercent / 100);
  }, [clock, tempoPercent, audioReady]);

  async function onLoadRecording(file: File) {
    setUserAudioError(null);
    const token = sessionToken.current;
    try {
      const next = await loadUserAudio(file, session?.timeline.durationSeconds ?? 0);
      if (token !== sessionToken.current) {
        // another song was opened while this recording loaded
        next.dispose();
        return;
      }
      const position = clock?.time() ?? 0;
      session?.clock.pause();
      next.setRate(tempoPercent / 100);
      next.seek(position);
      replaceUserClock(next);
      resetProfile();
      void restoreProfile(file, next);
    } catch (e) {
      // keep whatever was playing before
      setUserAudioError(e instanceof Error ? e.message : 'That recording could not be opened.');
    }
  }

  function onRemoveRecording() {
    const position = (stems?.clock ?? userClock)?.time() ?? 0;
    replaceUserClock(null);
    resetProfile();
    session?.clock.seek(position);
  }

  /** Sets the tuning the file is really in; the sound is rebuilt from the changed score. */
  function onFileTuningChange(id: string) {
    if (!session) return;
    const preset = id === WRITTEN ? undefined : presetById(id);
    applyFileTuning(session.score, session.written, trackIndex, preset?.tuning ?? null);
    const timeline = buildTimeline(session.score);
    session.clock.dispose();
    setSession({ ...session, timeline, clock: connectAudio(session.score, timeline) });
    setTuningId(FILE_TUNING);
    playingRef.current = false;
    setPlaying(false);
  }

  function retryAudio() {
    if (!session) return;
    session.clock.dispose();
    setSession({ ...session, clock: connectAudio(session.score, session.timeline) });
  }

  const onFrame = useCallback(
    (t: number) => {
      if (!clock) return;
      if (clock.playing !== playingRef.current) {
        playingRef.current = clock.playing;
        setPlaying(clock.playing);
      }
      // update the readout about ten times a second, not every frame
      const tenth = Math.floor(t * 10);
      if (tenth !== lastShown.current) {
        lastShown.current = tenth;
        setSeconds(t);
      }
    },
    [clock],
  );

  const togglePlay = useCallback(() => {
    if (!clock || !audioReady) return;
    if (clock.playing) clock.pause();
    else clock.play();
    playingRef.current = clock.playing;
    setPlaying(clock.playing);
  }, [clock, audioReady]);

  const setLoopRange = useCallback((next: LoopBars | null) => {
    setLoop(next);
    setLoopOn(next !== null);
  }, []);

  useEffect(() => {
    if (!clock || !timeline || exportOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = interpretKey(e.key, { tag: target?.tagName ?? 'body' });
      if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      switch (action) {
        case 'toggle-play':
          togglePlay();
          break;
        case 'seek-back':
          clock.seek(seekByBar(timeline, clock.time(), -1));
          break;
        case 'seek-forward':
          clock.seek(seekByBar(timeline, clock.time(), 1));
          break;
        case 'tempo-up':
          setTempoPercent((p) => Math.min(125, p + 5));
          break;
        case 'tempo-down':
          setTempoPercent((p) => Math.max(25, p - 5));
          break;
        case 'toggle-loop':
          if (loop) setLoopOn((on) => !on);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, timeline, loop, togglePlay, exportOpen]);

  const barCount = timeline?.scoreBarCount ?? 0;
  const title = timeline?.title || 'Untitled';
  const songsterrLink = timeline ? songsterrLinkForSong(timeline.title, timeline.artist) : null;

  if (!support.canPractice) {
    return (
      <main className="app">
        <section className="dropzone" role="alert">
          <h1>Tab Highway</h1>
          <p className="error">{support.notice}</p>
        </section>
        <Notices />
      </main>
    );
  }

  if (!session || !clock || !timeline) {
    return (
      <main className="app">
        {support.notice && (
          <p className="notice" role="status">
            {support.notice}
          </p>
        )}
        <DropZone onFile={onFile} onSample={onSample} error={error} loading={loading} />
        <Notices />
      </main>
    );
  }

  const track = timeline.tracks[trackIndex];

  return (
    <main className="app">
      <header className="topbar">
        <h1>{title}</h1>
        <TrackPicker
          tracks={timeline.tracks}
          value={trackIndex}
          onChange={(i) => {
            setTrackIndex(i);
            setTuningId(FILE_TUNING);
          }}
        />
        <FileTuningPicker
          written={session.written[trackIndex]?.[0] ?? []}
          current={sourceTimeline?.tracks[trackIndex]?.tuning ?? []}
          onChange={onFileTuningChange}
        />
        <TuningPicker track={sourceTimeline?.tracks[trackIndex]} value={tuningId} onChange={setTuningId} />
        <ViewControls
          view={bottomView}
          lookahead={lookahead}
          labelMode={labelMode}
          onViewChange={setBottomView}
          onLookaheadChange={setLookahead}
          onLabelModeChange={setLabelMode}
        />
        {songsterrLink && (
          <a className="link-button" href={songsterrLink} target="_blank" rel="noopener noreferrer">
            Find on Songsterr
          </a>
        )}
        <button type="button" onClick={() => { clock.pause(); setExportOpen(true); }} disabled={!audioReady}>
          Export video
        </button>
        <button
          type="button"
          onClick={() => {
            sessionToken.current += 1;
            session.clock.dispose();
            replaceUserClock(null);
            setSession(null);
          }}
        >
          Open another file
        </button>
      </header>
      {track && !track.hasTabData && (
        <p className="notice" role="status">
          This file has no tab data for this track, so fret positions were chosen automatically and may differ from a real tab.
        </p>
      )}
      <Stage
        timeline={timeline}
        trackIndex={trackIndex}
        clock={clock}
        bottomView={bottomView}
        lookahead={lookahead}
        labelMode={labelMode}
        loop={loopOn ? loop : null}
        onLoopChange={setLoopRange}
        onSeekBar={(bar) => {
          const layout = getStripLayout(timeline, trackIndex, 1, 1);
          const start = scoreBarStartSeconds(layout, bar);
          if (start !== null) clock.seek(start);
        }}
        onFrame={onFrame}
      />
      {audio.status === 'loading' && (
        <p role="status" className="notice">
          Loading sound… {Math.round(audio.progress * 100)}%
        </p>
      )}
      {audio.status === 'failed' && (
        <p role="alert" className="error">
          The sound could not be loaded ({audio.message}).{' '}
          <button type="button" onClick={retryAudio}>
            Retry
          </button>
        </p>
      )}
      <Transport
        disabled={!audioReady}
        playing={playing}
        tempoPercent={tempoPercent}
        seconds={seconds}
        durationSeconds={timeline.durationSeconds}
        onTogglePlay={togglePlay}
        onRestart={() => clock.seek(0)}
        onTempoChange={setTempoPercent}
        onSeek={(s) => clock.seek(s)}
      />
      <OffsetSlider
        offsetSeconds={userClock || stems ? offset : null}
        fileName={userClock?.file?.name ?? stems?.title ?? null}
        error={userAudioError}
        onLoad={onLoadRecording}
        onOffsetChange={(raw) => {
          const seconds = clampOffset(raw);
          userClock?.setOffset(seconds);
          stems?.clock.setOffset(seconds);
          setOffset(seconds);
          live.current.offset = seconds;
          offsetMoved.current = true;
          scheduleProfileSave(seconds);
        }}
        onRemove={onRemoveRecording}
      />
      <StemPanel
        recording={userClock?.file ?? null}
        durationSeconds={timeline.durationSeconds}
        active={stems}
        mix={mix}
        onMixChange={(next) => {
          setMix(next);
          mixMoved.current = true;
          if (isDesktop()) {
            profileMix.current = next;
            scheduleProfileSave(live.current.offset);
          }
        }}
        onActivate={activateStems}
      />
      <LoopControls
        barCount={barCount}
        loop={loop}
        enabled={loopOn}
        onChange={setLoopRange}
        onToggle={() => setLoopOn((on) => !on)}
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {exportOpen && (
        <ExportDialog
          timeline={timeline}
          trackIndex={trackIndex}
          bottom={{ view: bottomView, lookahead, labelMode }}
          onClose={() => setExportOpen(false)}
          getAudio={(onProgress) =>
            stems
              ? renderStemMix(stems.sources, mix, stems.clock.offset, timeline.durationSeconds)
              : userClock?.file
              ? decodeUserRecording(userClock.file, userClock.offset, timeline.durationSeconds)
              : session.clock.exportAudio(onProgress)
          }
        />
      )}
      <Notices />
    </main>
  );
}
