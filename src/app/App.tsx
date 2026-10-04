import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlaybackClock } from '../audio/clock';
import { buildTimeline, loadAlphaTex, loadScoreFromBytes } from '../model/alphatab-adapter';
import type { Timeline } from '../model/score';
import { getStripLayout, scoreBarStartSeconds, type LoopBars } from '../render/tab-strip';
import { DropZone } from './DropZone';
import { LoopControls } from './LoopControls';
import { SAMPLE_ALPHATEX } from './sample';
import { Stage } from './Stage';
import { TrackPicker } from './TrackPicker';
import { Transport } from './Transport';
import { interpretKey, seekByBar } from './navigation';
import './app.css';

const NOW = () => performance.now() / 1000;

interface Session {
  timeline: Timeline;
  clock: PlaybackClock;
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
  const lastShown = useRef(-1);

  function startSession(timeline: Timeline) {
    setSession({ timeline, clock: new PlaybackClock(NOW, timeline.durationSeconds) });
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
      const timeline = buildTimeline(loadScoreFromBytes(bytes));
      if (timeline.notesForTrack(firstPlayableTrack(timeline)).length === 0) {
        throw new Error('That file has no playable guitar notes.');
      }
      startSession(timeline);
    } catch (e) {
      // keep the previous session; just report the problem
      setError(e instanceof Error && e.message ? `Could not open that file: ${e.message}` : 'Could not open that file.');
    } finally {
      setLoading(false);
    }
  }

  function onSample() {
    try {
      startSession(buildTimeline(loadAlphaTex(SAMPLE_ALPHATEX)));
    } catch {
      setError('Could not load the sample.');
    }
  }

  const clock = session?.clock;
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
    if (first && last) clock.setLoop({ start: first.playback.startSeconds, end: last.playback.endSeconds });
  }, [clock, timeline, trackIndex, loop, loopOn]);

  useEffect(() => {
    clock?.setRate(tempoPercent / 100);
  }, [clock, tempoPercent]);

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
    if (!clock) return;
    if (clock.playing) clock.pause();
    else clock.play();
    setPlaying(clock.playing);
  }, [clock]);

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
        <button type="button" onClick={() => setSession(null)}>
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
      <Transport
        playing={playing}
        tempoPercent={tempoPercent}
        seconds={seconds}
        durationSeconds={timeline.durationSeconds}
        onTogglePlay={togglePlay}
        onRestart={() => clock.seek(0)}
        onTempoChange={setTempoPercent}
        onSeek={(s) => clock.seek(s)}
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
