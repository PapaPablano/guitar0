import { useEffect, useMemo, useRef, useState } from 'react';
import { initialMix, type MixState } from '../audio/mix-gains';
import type { StemMixClock } from '../audio/stem-mix';
import type { StemSources } from '../export/stem-audio';
import { EngineClient, SeparationCancelled, STEM_NAMES, type StemName } from '../stems/engine-client';
import { hashFile } from '../stems/file-hash';
import { loadStems } from '../stems/load-stems';
import { SavedStems, shellStemIndex } from '../stems/saved-stems';
import { isDesktop } from './desktop';
import { describeEngine, readEngineStatus, startEngineSetup, type ShellEngineStatus } from './engine-state';
import { separateControl, setStemVolume, toggleStemMute, toggleStemSolo } from './stem-controls';

export interface ActiveStems {
  readonly clock: StemMixClock;
  readonly sources: StemSources;
}

interface StemPanelProps {
  recording: File | null;
  durationSeconds: number;
  active: ActiveStems | null;
  mix: MixState;
  onMixChange: (mix: MixState) => void;
  onActivate: (stems: ActiveStems | null) => void;
}

const STATUS_POLL_MS = 1000;
const savedStems = new SavedStems(shellStemIndex);

/** Separate-and-mix controls. Renders nothing outside the desktop app. */
export function StemPanel({ recording, durationSeconds, active, mix, onMixChange, onActivate }: StemPanelProps) {
  const desktop = isDesktop();
  const [status, setStatus] = useState<ShellEngineStatus | null>(null);
  const [savedJob, setSavedJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const hashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let stopped = false;
    const tick = () => {
      readEngineStatus().then(
        (s) => !stopped && setStatus(s),
        () => undefined,
      );
    };
    tick();
    const id = setInterval(tick, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [desktop]);

  const client = useMemo(
    () => (status?.phase === 'ready' && status.url && status.secret ? new EngineClient({ baseUrl: status.url, secret: status.secret }) : null),
    [status?.phase, status?.url, status?.secret],
  );

  // Look the recording up among saved stems whenever it changes.
  useEffect(() => {
    setSavedJob(null);
    hashRef.current = null;
    if (!recording || !client) return;
    let stale = false;
    (async () => {
      const hash = await hashFile(recording);
      if (stale) return;
      hashRef.current = hash;
      const job = await savedStems.find(hash, (id) => client.jobExists(id));
      if (!stale) setSavedJob(job);
    })().catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [recording, client]);

  if (!desktop) return null;

  const engine = describeEngine(status);
  const control = separateControl({ engine, hasRecording: recording !== null, hasSaved: savedJob !== null, busy });

  async function run() {
    if (!recording || !client) return;
    setError(null);
    setBusy(true);
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      let jobId = savedJob;
      if (!jobId) {
        jobId = await client.separate(recording, { onProgress: setProgress, signal: controller.signal });
        const hash = hashRef.current ?? (await hashFile(recording));
        await savedStems.record(hash, jobId);
        setSavedJob(jobId);
      }
      const context = new AudioContext();
      await context.resume();
      const loaded = await loadStems(client, jobId, durationSeconds, context);
      onActivate(loaded);
    } catch (e) {
      if (!(e instanceof SeparationCancelled)) setError(e instanceof Error ? e.message : 'Separation failed.');
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  function change(next: MixState) {
    onMixChange(next);
    active?.clock.setMix(next);
  }

  return (
    <div className="stems" role="group" aria-label="Stems">
      {!active && control.visible && (
        <div className="stems-row">
          <button type="button" disabled={control.disabled} onClick={() => void run()}>
            {control.label}
          </button>
          {busy && (
            <>
              <progress value={progress} max={1} aria-label="Separation progress" />
              <button type="button" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            </>
          )}
          {engine.kind === 'setup' && engine.progress !== null && <progress value={engine.progress} max={1} aria-label="Setup progress" />}
          {control.note && <span className="muted">{control.note}</span>}
          {engine.canRetry && (
            <button type="button" onClick={() => void startEngineSetup().catch((e: unknown) => setError(String(e)))}>
              {engine.kind === 'blocked' ? 'Restart engine' : 'Set up'}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {active && (
        <div className="stem-mixer">
          <div className="stems-row">
            <button type="button" onClick={() => change(toggleStemMute(mix, 'guitar'))} aria-pressed={mix.guitar.muted}>
              {mix.guitar.muted ? 'Unmute guitar' : 'Mute guitar'}
            </button>
            <button type="button" onClick={() => onActivate(null)}>
              Back to the plain recording
            </button>
          </div>
          {STEM_NAMES.map((name: StemName) => (
            <div className="stem-row" key={name}>
              <span className="stem-name">{name}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={mix[name].volume}
                aria-label={`${name} volume`}
                onChange={(e) => change(setStemVolume(mix, name, Number(e.target.value)))}
              />
              <button type="button" aria-pressed={mix[name].muted} onClick={() => change(toggleStemMute(mix, name))}>
                M
              </button>
              <button type="button" aria-pressed={mix[name].solo} onClick={() => change(toggleStemSolo(mix, name))}>
                S
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { initialMix };
