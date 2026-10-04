import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Clock } from '../audio/clock';
import { createSynthSession, type SynthClock } from '../audio/synth-bridge';
import { loadUserAudio, type UserAudioClock } from '../audio/user-audio';
import type { model as AlphaModel } from '@coderline/alphatab';
import { buildTimeline, loadAlphaTex, loadScoreFromBytes } from '../model/alphatab-adapter';
import type { Timeline } from '../model/score';
import { getStripLayout, scoreBarStartSeconds, type LoopBars } from '../render/tab-strip';
import { DropZone } from './DropZone';
import { LoopControls } from './LoopControls';
import { OffsetSlider } from './OffsetSlider';
import { SAMPLE_ALPHATEX } from './sample';
import { Stage } from './Stage';
import { TrackPicker } from './TrackPicker';
import { Transport } from './Transport';
import { interpretKey, seekByBar } from './navigation';
import './app.css';

const SOUND_FONT_URL = './soundfont/sonivox.sf3';

type AudioState = { status: 'loading'; progress: number } | { status: 'ready' } | { status: 'failed'; message: string };

interface Session {
  timeline: Timeline;
  score: AlphaModel.Score;
  clock: SynthClock;
}

function firstPlayableTrack(timeline: Timeline): number {
  return timeline.tracks.find((t) => !t.isPercussion)?.index ?? 0;
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
  const [userClock, setUserClock] = useState<UserAudioClock | null>(null);
  const [offset, setOffset] = useState(0);
  const [userAudioError, setUserAudioError] = useState<string | null>(null);
  const lastShown = useRef(-1);

  function connectAudio(next: Session) {
    setAudio({ status: 'loading', progress: 0 });
    const synth = createSynthSession(next.score, next.timeline.durationSeconds, next.timeline.tempoMap, {
      soundFontUrl: SOUND_FONT_URL,
      onProgress: (progress) => setAudio((a) => (a.status === 'loading' ? { status: 'loading', progress } : a)),
    });
    synth.ready.then(
      () => setAudio({ status: 'ready' }),
      (e: unknown) => setAudio({ status: 'failed', message: e instanceof Error ? e.message : 'The sound could not be loaded.' }),
    );
    return synth.clock;
  }

  function startSession(score: AlphaModel.Score, timeline: Timeline) {
    session?.clock.dispose();
    userClock?.dispose();
    setUserClock(null);
    setOffset(0);
    setUserAudioError(null);
    const draft = { timeline, score } as Session;
    draft.clock = connectAudio(draft);
    setSession(draft);
    setTrackIndex(firstPlayableTrack(timeline));
    setTempoPercent(100);
    setLoop(null);
    setLoopOn(false);
    setPlaying(false);
    setSeconds(0);
    setError(null);
  }

  async function onFile(file: File) {
    setLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const score = loadScoreFromBytes(bytes);
      const timeline = buildTimeline(score);
      if (timeline.notesForTrack(firstPlayableTrack(timeline)).length === 0) {
        throw new Error('That file has no playable guitar notes.');
      }
      startSession(score, timeline);
    } catch (e) {
      // keep the previous session; just report the problem
      setError(e instanceof Error && e.message ? `Could not open that file: ${e.message}` : 'Could not open that file.');
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

  const clock: Clock | undefined = userClock ?? session?.clock;
  const timeline = session?.timeline;

  // Apply the loop to the clock whenever the loop or its switch changes.
  useEffect(() => {
    if (!clock || !timeline) return;
    if (!loop || !loopOn) {
      clock.setLoop(null);
      return;
    }
    const layout = getStripLayout(timeline, trackIndex, 1, 1);
    const first = layout.bars.find((b) => b.scoreBar === loop.startBar);
    const last = layout.bars.find((b) => b.scoreBar === loop.endBar);
    if (first && last) {
      clock.setLoop({
        start: first.playback.startSeconds,
        end: last.playback.endSeconds,
        startTick: first.playback.startTick,
        endTick: last.playback.endTick,
      });
    }
  }, [clock, timeline, trackIndex, loop, loopOn]);

  // Dev-only handle so the clock can be sampled from the browser console during manual checks.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __clock?: Clock }).__clock = clock;
  }, [clock]);

  const audioReady = audio.status === 'ready' || userClock !== null;
  useEffect(() => {
    if (audioReady) clock?.setRate(tempoPercent / 100);
  }, [clock, tempoPercent, audioReady]);

  async function onLoadRecording(file: File) {
    setUserAudioError(null);
    try {
      const next = await loadUserAudio(file, session?.timeline.durationSeconds ?? 0);
      const position = clock?.time() ?? 0;
      session?.clock.pause();
      userClock?.dispose();
      next.setRate(tempoPercent / 100);
      next.seek(position);
      setUserClock(next);
      setOffset(0);
    } catch (e) {
      // keep whatever was playing before
      setUserAudioError(e instanceof Error ? e.message : 'That recording could not be opened.');
    }
  }

  function onRemoveRecording() {
    const position = userClock?.time() ?? 0;
    userClock?.dispose();
    setUserClock(null);
    setOffset(0);
    session?.clock.seek(position);
  }

  function retryAudio() {
    if (!session) return;
    session.clock.dispose();
    const next = { ...session } as Session;
    next.clock = connectAudio(next);
    setSession(next);
  }

  const onFrame = useCallback(
    (t: number) => {
      if (!clock) return;
      if (clock.playing !== playing) setPlaying(clock.playing);
      // update the readout about ten times a second, not every frame
      const tenth = Math.floor(t * 10);
      if (tenth !== lastShown.current) {
        lastShown.current = tenth;
        setSeconds(t);
      }
    },
    [clock, playing],
  );

  const togglePlay = useCallback(() => {
    if (!clock || !audioReady) return;
    if (clock.playing) clock.pause();
    else clock.play();
    setPlaying(clock.playing);
  }, [clock, audioReady]);

  const setLoopRange = useCallback((next: LoopBars | null) => {
    setLoop(next);
    setLoopOn(next !== null);
  }, []);

  useEffect(() => {
    if (!clock || !timeline) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = interpretKey(e.key, {
        tag: target?.tagName ?? 'body',
        inputType: (target as HTMLInputElement | null)?.type,
      });
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
  }, [clock, timeline, loop, togglePlay]);

  const barCount = timeline?.scoreBarCount ?? 0;
  const title = useMemo(() => timeline?.title || 'Untitled', [timeline]);

  if (!session || !clock || !timeline) {
    return (
      <main className="app">
        <DropZone onFile={onFile} onSample={onSample} error={error} loading={loading} />
      </main>
    );
  }

  const track = timeline.tracks[trackIndex];

  return (
    <main className="app">
      <header className="topbar">
        <h1>{title}</h1>
        <TrackPicker tracks={timeline.tracks} value={trackIndex} onChange={setTrackIndex} />
        <button
          type="button"
          onClick={() => {
            session.clock.dispose();
            userClock?.dispose();
            setUserClock(null);
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
        offsetSeconds={userClock ? offset : null}
        fileName={userClock?.file?.name ?? null}
        error={userAudioError}
        onLoad={onLoadRecording}
        onOffsetChange={(seconds) => {
          userClock?.setOffset(seconds);
          setOffset(seconds);
        }}
        onRemove={onRemoveRecording}
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
    </main>
  );
}
