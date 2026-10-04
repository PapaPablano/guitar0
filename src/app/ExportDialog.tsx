import { useEffect, useRef, useState } from 'react';
import type { PcmAudio } from '../export/audio';
import { browserExportEnvironment, checkExportSupport, type ExportSupport } from '../export/capability';
import { ExportCancelled, startExport, type ExportJob } from '../export/exporter';
import { estimateMegabytes, MAX_EXPORT_SECONDS, PRESETS, presetById, type ExportPreset } from '../export/presets';
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
  /** Produces the whole song's audio at original tempo: the synth mix or the user's recording. */
  getAudio: (onProgress: (fraction: number) => void) => Promise<PcmAudio>;
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

export function ExportDialog({ timeline, trackIndex, getAudio, onClose }: ExportDialogProps) {
  const [presetId, setPresetId] = useState<ExportPreset['id']>('landscape');
  const [support, setSupport] = useState<ExportSupport | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const job = useRef<ExportJob | null>(null);
  const cancelledEarly = useRef(false);
  const preset = presetById(presetId);
  const tooLong = timeline.durationSeconds > MAX_EXPORT_SECONDS;

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

  async function start() {
    cancelledEarly.current = false;
    setPhase({ name: 'preparing', fraction: 0 });
    try {
      const audio = await getAudio((fraction) => setPhase({ name: 'preparing', fraction }));
      if (cancelledEarly.current) {
        setPhase({ name: 'idle' });
        return;
      }
      setPhase({ name: 'exporting', fraction: 0 });
      const running = startExport({
        timeline,
        trackIndex,
        preset,
        audio,
        onProgress: (fraction) => setPhase({ name: 'exporting', fraction }),
      });
      job.current = running;
      const blob = await running.result;
      const url = URL.createObjectURL(blob);
      const filename = safeFilename(timeline.title);
      setPhase({ name: 'done', url, filename });
      download(url, filename);
    } catch (e) {
      if (e instanceof ExportCancelled) {
        setPhase({ name: 'idle' });
      } else {
        setPhase({ name: 'failed', reason: e instanceof Error && e.message ? e.message : 'The export failed.' });
      }
    } finally {
      job.current = null;
    }
  }

  function cancel() {
    cancelledEarly.current = true;
    job.current?.cancel();
    if (!job.current) setPhase({ name: 'idle' });
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
                  <select value={presetId} onChange={(e) => setPresetId(e.target.value as ExportPreset['id'])}>
                    {PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  The whole song at original tempo, {formatDuration(timeline.durationSeconds)} long, about{' '}
                  {Math.max(1, Math.round(estimateMegabytes(preset, timeline.durationSeconds)))} MB. Loops and tempo changes
                  are not applied.
                </p>
                {tooLong && (
                  <p role="alert" className="error">
                    This song is {formatDuration(timeline.durationSeconds)} long. Export is limited to{' '}
                    {formatDuration(MAX_EXPORT_SECONDS)}.
                  </p>
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
              disabled={!support || !support.supported || tooLong}
            >
              Start export
            </button>
          )}
          {phase.name === 'failed' && (
            <button type="button" onClick={() => void start()}>
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
