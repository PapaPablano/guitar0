import { useEffect, useRef, useState } from 'react';
import type { AlignmentMap } from '../audio/alignment-map';
import { exportLength, type PcmAudio } from '../export/audio';
import { audioFilename, encodeWav, planAudioExport, type TimeRange } from '../export/audio-file';
import { browserExportEnvironment, checkExportSupport, type ExportSupport } from '../export/capability';
import { ExportCancelled, startExport, type ExportJob } from '../export/exporter';
import { loadNeckPhoto } from '../export/neck-photo';
import { estimateMegabytes, PRESETS, presetById, type ExportPreset } from '../export/presets';
import type { ExportViewOptions } from '../render/stage-frame';
import { panelsOf, PANEL_NAMES, type StageLayout } from './stage-layout';
import type { Timeline } from '../model/score';

type Phase =
  | { name: 'idle' }
  | { name: 'preparing'; fraction: number }
  | { name: 'exporting'; fraction: number }
  | { name: 'done'; url: string; filename: string }
  | { name: 'failed'; reason: string };

interface ExportDialogProps {
  timeline: Timeline;
  trackIndex: number;
  /** The views on the page when the dialog opened; the video shows the same ones. */
  stageLayout: StageLayout;
  /** The look-ahead, dot labels and technique cues in use when the dialog opened; the video shows the same. */
  view: ExportViewOptions;
  /** Changes the one remembered choice of whether the neck shows technique cues; the checkbox here and the switch in full screen share it. */
  onNeckCuesChange?: (on: boolean) => void;
  /** Produces the whole song's audio at original tempo: the synth mix or the user's recording. */
  getAudio: (onProgress: (fraction: number) => void, range?: { startSeconds: number; durationSeconds: number }) => Promise<PcmAudio>;
  /** The loop's span in the export's own time (see `outputWindow`), when a loop is set; offered for the audio export. */
  loopRange?: TimeRange | null;
  /** Where the recording sits against the tab; the export lasts through any extra playing, with the tab waiting. */
  alignment?: AlignmentMap | null;
  onClose: () => void;
}

function safeFilename(title: string): string {
  const base = title.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
  return `${base || 'tab'}-highway.mp4`;
}

function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function ExportDialog({ timeline, trackIndex, stageLayout, view, onNeckCuesChange, getAudio, loopRange = null, alignment = null, onClose }: ExportDialogProps) {
  const [presetId, setPresetId] = useState<ExportPreset['id']>('landscape');
  const [support, setSupport] = useState<ExportSupport | null>(null);
  const panels = panelsOf(stageLayout);
  const [loopOnly, setLoopOnly] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const job = useRef<ExportJob | null>(null);
  /** Bumped by every start and cancel; a run that is no longer current must not touch state. */
  const runId = useRef(0);
  /** Which export ran last, so Retry repeats that one and not the other. */
  const lastKind = useRef<'audio' | 'video'>('video');
  const preset = presetById(presetId);
  /** The tab plus any extra playing: how long the video and the whole-song audio last. */
  const songSeconds = exportLength(timeline.durationSeconds, alignment);

  useEffect(() => {
    let live = true;
    setSupport(null);
    void checkExportSupport(browserExportEnvironment(), preset).then((s) => {
      if (live) setSupport(s);
    });
    return () => {
      live = false;
    };
  }, [preset]);

  // Closing the dialog abandons any export still running.
  useEffect(() => {
    return () => {
      runId.current += 1;
      job.current?.cancel();
    };
  }, []);

  // Free a finished file's URL when the dialog closes.
  useEffect(() => {
    return () => {
      if (phase.name === 'done') URL.revokeObjectURL(phase.url);
    };
  }, [phase]);

  function download(url: string, filename: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }

  async function saveAudio() {
    lastKind.current = 'audio';
    runId.current += 1;
    const run = runId.current;
    const current = () => run === runId.current;
    const useLoop = loopOnly && loopRange !== null;
    const plan = planAudioExport(songSeconds, useLoop ? loopRange : null);
    if (!plan.ok) {
      setPhase({ name: 'failed', reason: plan.reason });
      return;
    }
    setPhase({ name: 'preparing', fraction: 0 });
    try {
      const audio = await getAudio(
        (fraction) => current() && setPhase({ name: 'preparing', fraction }),
        useLoop ? { startSeconds: plan.startSeconds, durationSeconds: plan.durationSeconds } : undefined,
      );
      if (!current()) return;
      const url = URL.createObjectURL(new Blob([encodeWav(audio)], { type: 'audio/wav' }));
      const filename = audioFilename(timeline.title, useLoop);
      setPhase({ name: 'done', url, filename });
      download(url, filename);
    } catch (e) {
      if (!current()) return;
      setPhase({ name: 'failed', reason: e instanceof Error && e.message ? e.message : 'The export failed.' });
    }
  }

  async function start() {
    lastKind.current = 'video';
    runId.current += 1;
    const run = runId.current;
    const current = () => run === runId.current;
    setPhase({ name: 'preparing', fraction: 0 });
    try {
      const audio = await getAudio((fraction) => current() && setPhase({ name: 'preparing', fraction }));
      if (!current()) return;
      const photo = panels.includes('neck') ? await loadNeckPhoto() : undefined;
      if (!current()) {
        photo?.close();
        return;
      }
      setPhase({ name: 'exporting', fraction: 0 });
      const running = startExport({
        timeline,
        trackIndex,
        preset,
        audio,
        panels,
        view,
        photo,
        alignment,
        onProgress: (fraction) => current() && setPhase({ name: 'exporting', fraction }),
      });
      job.current = running;
      const blob = await running.result;
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      const filename = safeFilename(timeline.title);
      setPhase({ name: 'done', url, filename });
      download(url, filename);
    } catch (e) {
      if (!current()) return;
      if (e instanceof ExportCancelled) {
        setPhase({ name: 'idle' });
      } else {
        setPhase({ name: 'failed', reason: e instanceof Error && e.message ? e.message : 'The export failed.' });
      }
    } finally {
      if (current()) job.current = null;
    }
  }

  function cancel() {
    runId.current += 1;
    job.current?.cancel();
    job.current = null;
    setPhase({ name: 'idle' });
  }

  const busy = phase.name === 'preparing' || phase.name === 'exporting';

  return (
    <div className="overlay">
      <section className="dialog" role="dialog" aria-modal="true" aria-label="Export video">
        <h2>Export video</h2>

        {phase.name === 'idle' && (
          <>
            {support && !support.supported ? (
              <p role="alert" className="error">
                {support.reason}
              </p>
            ) : (
              <>
                <label className="field">
                  Preset
                  <select value={presetId} onChange={(e) => setPresetId(presetById(e.target.value).id)}>
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Shows: {panels.map((p) => PANEL_NAMES[p]).join(' + ')}{' '}
                  <span className="muted">(change it under Views on the player)</span>
                </p>
                {panels.includes('neck') && onNeckCuesChange && (
                  <label className="field">
                    <input type="checkbox" checked={view.neckCues ?? true} onChange={(e) => onNeckCuesChange(e.target.checked)} /> Show
                    technique cues (hammer-ons, slides, bends)
                  </label>
                )}
                <p className="muted">
                  The whole song at original tempo, {formatDuration(songSeconds)} long, about{' '}
                  {Math.max(1, Math.round(estimateMegabytes(preset, songSeconds)))} MB. Loops and tempo changes
                  are not applied.
                </p>
                {loopRange && (
                  <label className="field">
                    <input type="checkbox" checked={loopOnly} onChange={(e) => setLoopOnly(e.target.checked)} /> Only the
                    looped section (audio file)
                  </label>
                )}
              </>
            )}
          </>
        )}

        {phase.name === 'preparing' && (
          <p role="status">Rendering the audio… {Math.round(phase.fraction * 100)}%</p>
        )}
        {phase.name === 'exporting' && (
          <>
            <progress value={phase.fraction} max={1} aria-label="Export progress" />
            <p role="status">Encoding the video… {Math.round(phase.fraction * 100)}%</p>
          </>
        )}
        {phase.name === 'done' && (
          <p role="status">
            Done. Your download should have started.{' '}
            <button type="button" onClick={() => download(phase.url, phase.filename)}>
              Save again
            </button>
          </p>
        )}
        {phase.name === 'failed' && (
          <p role="alert" className="error">
            The export failed: {phase.reason}
          </p>
        )}

        <div className="actions">
          {phase.name === 'idle' && (
            <button
              type="button"
              onClick={() => void start()}
              disabled={!support || !support.supported}
            >
              Start export
            </button>
          )}
          {phase.name === 'idle' && (
            <button type="button" onClick={() => void saveAudio()}>
              Save audio (WAV)
            </button>
          )}
          {phase.name === 'failed' && (
            <button type="button" onClick={() => void (lastKind.current === 'audio' ? saveAudio() : start())}>
              Retry
            </button>
          )}
          {busy && (
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
