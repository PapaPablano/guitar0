import { useCallback, useEffect, useRef, useState } from 'react';
import type { Clock } from '../audio/clock';
import { defaultProfileStorage } from '../audio/profile-store-web';
import { createCaptureFlow, type FlowState } from '../export/capture-check-flow';
import { playHeard, runCaptureCheck } from '../export/capture-check-run';
import { acquireStream, inspectStream, recordingFilename, recordProgress, startRecorder, type CaptureSession } from '../export/record-capture';
import { saveExport, type SaveResult } from '../export/save-export';
import type { CheckResult } from './capture-check-setting';

export type RecordState =
  | { name: 'idle' }
  | { name: 'picking' }
  | { name: 'checking' }
  | { name: 'report'; variant: 'before-recording' | 'check-only'; result: CheckResult; canHear: boolean }
  | { name: 'recording'; seconds: number; total: number }
  | { name: 'saving' }
  | { name: 'done'; saved: SaveResult }
  | { name: 'failed'; reason: string };

interface RecordOptions {
  /** The clock the page follows now; the recording plays it from the start. */
  getClock: () => Clock | undefined;
  /** Pauses the synth, stems and loaded-recording clocks, so only the video's sound is in the file. */
  pauseOwnClocks?: () => void;
  totalSeconds: number;
  title: string;
}

/**
 * The "Record with video" export: shares the page, checks the sound on that share the first time, then records the page
 * with the docked YouTube player and its sound while the tab plays once from the start. It is a live recording, so it
 * lasts as long as the song.
 */
export function useRecordWithVideo({ getClock, pauseOwnClocks, totalSeconds, title }: RecordOptions) {
  const [state, setState] = useState<RecordState>({ name: 'idle' });
  const session = useRef<CaptureSession | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const restore = useRef<(() => void) | null>(null);
  const finishing = useRef(false);
  const latest = useRef({ getClock, pauseOwnClocks, totalSeconds, title });
  latest.current = { getClock, pauseOwnClocks, totalSeconds, title };
  const stateRef = useRef(state);
  stateRef.current = state;

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
      else setState({ name: 'idle' });
    } catch (e) {
      session.current = null;
      setState({ name: 'failed', reason: e instanceof Error && e.message ? e.message : 'The recording failed.' });
    } finally {
      finishing.current = false;
      flow.current?.finished();
    }
  }, []);

  /** The long recorder is running: take the clock from the start, with only the video's sound playing. */
  const beginRecording = useCallback(
    (capture: CaptureSession) => {
      const clock = latest.current.getClock();
      if (!clock) {
        capture.cancel();
        flow.current?.finished();
        setState({ name: 'failed', reason: 'There is nothing to record.' });
        return;
      }
      session.current = capture;
      latest.current.pauseOwnClocks?.();
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
    },
    [finish],
  );

  const flow = useRef<ReturnType<typeof createCaptureFlow> | null>(null);
  if (flow.current === null) {
    flow.current = createCaptureFlow(
      {
        acquire: () => acquireStream((options) => navigator.mediaDevices.getDisplayMedia(options)),
        inspect: inspectStream,
        runCheck: runCaptureCheck,
        // The flow watches the share ending itself, so the recorder's own listener has nothing to add.
        startRecorder: (stream, choice) => startRecorder(stream, { onEnded: () => undefined }, choice),
        storage: defaultProfileStorage(),
        currentSampleRate: () => null,
        now: () => new Date().toISOString(),
      },
      {
        onState: (next: FlowState) => {
          if (next.name === 'recording') return;
          if (next.name === 'idle') setState((prev) => (prev.name === 'picking' || prev.name === 'checking' || prev.name === 'report' ? { name: 'idle' } : prev));
          else setState(next);
        },
        onRecording: (capture) => beginRecording(capture),
        onShareEnded: () => void finish(),
      },
    );
  }

  /** Call from a click: the browser only shows its share picker for a user action. */
  const start = useCallback(() => {
    if (!latest.current.getClock()) return;
    void flow.current?.start('record');
  }, []);

  /** Runs the sound check again without recording; also needs a click, for the picker. */
  const recheck = useCallback(() => void flow.current?.start('recheck'), []);

  /** Record anyway, from a warning. */
  const proceed = useCallback(() => flow.current?.proceed(), []);

  /** Stop and save while recording; otherwise ends the picker, the check or the warning. */
  const stop = useCallback(() => {
    if (stateRef.current.name === 'recording') void finish();
    else flow.current?.abort();
  }, [finish]);

  const dismiss = useCallback(() => {
    flow.current?.abort();
    setState({ name: 'idle' });
  }, []);

  /** Plays back the captured test sound. */
  const hear = useCallback(() => {
    const heard = flow.current?.heardSound();
    if (heard && stateRef.current.name !== 'recording') void playHeard(heard).catch(() => undefined);
  }, []);

  // Leaving the page abandons a recording or a check in progress.
  useEffect(
    () => () => {
      stopTimer();
      session.current?.cancel();
      session.current = null;
      flow.current?.abort();
      restore.current?.();
    },
    [],
  );

  return { state, start, recheck, proceed, stop, dismiss, hear };
}
