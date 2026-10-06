import { useEffect, useState } from 'react';
import type { ChunkState } from '../audio/recording-pcm';
import { stripSegments } from './exactness-text';

interface ExactnessStripProps {
  states: readonly ChunkState[];
  chunkSeconds: number;
  durationSeconds: number;
  /** Where the recording is now, in seconds; read a few times a second. */
  playheadSeconds: () => number;
  /** The line beside the strip, which doubles as its text for screen readers. */
  label: string;
}

/** How often the playhead mark is moved. */
const PLAYHEAD_MS = 250;

const STATE_CLASS: Record<ChunkState, string> = {
  exact: 'strip-exact',
  getting: 'strip-getting',
  'not-yet': 'strip-not-yet',
  failed: 'strip-not-yet',
};

/** The recording's length as a bar: green where a jump lands exactly, striped where it is being made exact, grey where it is not yet. */
export function ExactnessStrip({ states, chunkSeconds, durationSeconds, playheadSeconds, label }: ExactnessStripProps) {
  const [seconds, setSeconds] = useState(playheadSeconds);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(playheadSeconds()), PLAYHEAD_MS);
    return () => clearInterval(timer);
  }, [playheadSeconds]);
  const head = durationSeconds > 0 ? Math.min(1, Math.max(0, seconds / durationSeconds)) : 0;
  return (
    <div className="exactness-strip" role="img" aria-label={label || 'Which parts of the recording are exact'}>
      {stripSegments(states, chunkSeconds, durationSeconds).map((s) => (
        <span key={`${s.from}`} className={`strip-segment ${STATE_CLASS[s.state]}`} style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%` }} />
      ))}
      <span className="strip-head" style={{ left: `${head * 100}%` }} />
    </div>
  );
}
