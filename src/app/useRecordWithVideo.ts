import { useCallback, useEffect, useRef, useState } from 'react';
import type { Clock } from '../audio/clock';
import { recordingFilename, recordProgress, startCapture, type CaptureSession } from '../export/record-capture';
import { saveExport, type SaveResult } from '../export/save-export';

export type RecordState =
  | { name: 'idle' }
  | { name: 'recording'; seconds: number; total: number }
  | { name: 'saving' }
  | { name: 'done'; saved: SaveResult }
  | { name: 'failed'; reason: string };

interface RecordOptions {
  /** The clock the page follows now; the recording plays it from the start. */
  getClock: () => Clock | undefined;
  totalSeconds: number;
  title: string;
}

/**
 * The "Record with video" export: captures the page, with the docked YouTube player and its sound, while the tab plays
 * once from the start. It is a live recording, so it lasts as long as the song.
 */
export function useRecordWithVideo({ getClock, totalSeconds, title }: RecordOptions) {
  const [state, setState] = useState<RecordState>({ name: 'idle' });
  const session = useRef<CaptureSession | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const restore = useRef<(() => void) | null>(null);
  const finishing = useRef(false);
  const latest = useRef({ getClock, totalSeconds, title });
  latest.current = { getClock, totalSeconds, title };

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const finish = useCallback(async () => {
    const capture = session.current;
    if (!capture || finishing.current) return;
    finishing.current = true;
    stopTimer();
    latest.current.getClock()?.pause();
    restore.current?.();
    restore.current = null;
    setState({ name: 'saving' });
    try {
      const blob = await capture.stop();
      session.current = null;
      const saved = await saveExport(blob, recordingFilename(latest.current.title, capture.mime));
      if (saved.where !== 'cancelled') setState({ name: 'done', saved });
    } catch (e) {
      session.current = null;
      setState({ name: 'failed', reason: e instanceof Error && e.message ? e.message : 'The recording failed.' });
    } finally {
      finishing.current = false;
    }
  }, []);

  /** Call from a click: the browser only shows its share picker for a user action. */
  const start = useCallback(async () => {
    if (session.current) return;
    const clock = latest.current.getClock();
    if (!clock) return;
    try {
      session.current = await startCapture({ onEnded: () => void finish() });
    } catch (e) {
      if (e instanceof Error && e.name === 'NotAllowedError') setState({ name: 'idle' });
      else setState({ name: 'failed', reason: e instanceof Error && e.message ? e.message : 'The page could not be captured.' });
      return;
    }
    // A loop would wrap the song before the end, and a tempo change would make the recording a different length.
    const previousLoop = clock.loop;
    const previousRate = clock.rate;
    clock.setLoop(null);
    clock.setRate(1);
    restore.current = () => {
      clock.setLoop(previousLoop);
      clock.setRate(previousRate);
    };
    clock.seek(0);
    clock.play();
    const total = latest.current.totalSeconds;
    setState({ name: 'recording', seconds: 0, total });
    timer.current = setInterval(() => {
      const seconds = latest.current.getClock()?.time() ?? 0;
      setState({ name: 'recording', seconds, total });
      if (recordProgress(seconds, total).done) void finish();
    }, 250);
  }, [finish]);

  const stop = useCallback(() => void finish(), [finish]);
  const dismiss = useCallback(() => setState({ name: 'idle' }), []);

  // Leaving the page abandons a recording in progress.
  useEffect(
    () => () => {
      stopTimer();
      session.current?.cancel();
      session.current = null;
      restore.current?.();
    },
    [],
  );

  return { state, start, stop, dismiss };
}
