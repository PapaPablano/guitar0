import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { initialMix, MAX_STEM_VOLUME, type MixState } from '../audio/mix-gains';
import type { StemMixClock } from '../audio/stem-mix';
import type { StemSources } from '../export/stem-audio';
import { EngineClient, SeparationCancelled, STEM_NAMES, type SearchItem, type StemName } from '../stems/engine-client';
import { hashFile } from '../stems/file-hash';
import { audioContext, loadStems } from '../stems/load-stems';
import { createRunGuard } from '../stems/run-guard';
import { SavedStems, shellStemIndex } from '../stems/saved-stems';
import { isDesktop } from './desktop';
import { readYoutubeFlag, youtubeControls } from './feature-flags';
import { describeEngine, readEngineStatus, setupBar, startEngineSetup, type ShellEngineStatus } from './engine-state';
import { guitarAmount, guitarAmountLabel, searchRow, setGuitarAmount, separateControl, setStemVolume, toggleStemMute, toggleStemSolo, volumeLabel } from './stem-controls';

export interface ActiveStems {
  readonly clock: StemMixClock;
  readonly sources: StemSources;
  /** What the stems came from: the recording's file name or the video's title. */
  readonly title: string;
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

/** Where a separation's stems come from, and how to produce them when they are not saved yet. */
interface Source {
  /** Key in the saved-stems index. */
  key: () => Promise<string>;
  title: string;
  separate: (client: EngineClient, onProgress: (p: number) => void, signal: AbortSignal) => Promise<{ jobId: string; title?: string }>;
}

/** Search, separate and mix controls. Renders nothing outside the desktop app. */
export function StemPanel({ recording, durationSeconds, active, mix, onMixChange, onActivate }: StemPanelProps) {
  const desktop = isDesktop();
  const [status, setStatus] = useState<ShellEngineStatus | null>(null);
  const [savedJob, setSavedJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const runs = useRef(createRunGuard());
  const hashRef = useRef<string | null>(null);
  /** The newest mix, so two quick changes in a row build on each other instead of on a stale render. */
  const mixRef = useRef(mix);
  mixRef.current = mix;

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

  // A separation that finishes after the song or recording changed, or after the panel went away, must not apply.
  useEffect(() => {
    const guard = runs.current;
    return () => {
      guard.invalidate();
      abort.current?.abort();
    };
  }, [recording, durationSeconds]);

  if (!desktop) return null;

  const engine = describeEngine(status);
  const bar = setupBar(engine);
  const control = separateControl({ engine, hasRecording: recording !== null, hasSaved: savedJob !== null, busy });
  const youtube = youtubeControls({ enabled: readYoutubeFlag(), stemsEnabled: engine.stemsEnabled, hasResults: results !== null });

  /** Separates (or reuses saved stems for) a source, then plays them. */
  async function start(source: Source) {
    if (!client) return;
    setError(null);
    setBusy(true);
    setBusyLabel(source.title);
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    const run = runs.current.begin();
    const stale = () => !runs.current.isCurrent(run) || controller.signal.aborted;
    try {
      const key = await source.key();
      let jobId = await savedStems.find(key, (id) => client.jobExists(id));
      let title = source.title;
      if (!jobId) {
        const made = await source.separate(client, setProgress, controller.signal);
        jobId = made.jobId;
        title = made.title ?? title;
        // The stems exist now, so remember them even if the result is no longer wanted.
        if (!(await savedStems.tryRecord(key, jobId))) setError('The stems were made but could not be saved for next time.');
        else setSavedJob(jobId);
      }
      if (stale()) return;
      const context = audioContext();
      await context.resume();
      const loaded = await loadStems(client, jobId, durationSeconds, context);
      if (stale()) {
        loaded.clock.dispose();
        return;
      }
      onActivate({ ...loaded, title });
    } catch (e) {
      if (!(e instanceof SeparationCancelled)) setError(e instanceof Error ? e.message : 'Separation failed.');
    } finally {
      // Only the latest separation owns the busy state; an older, superseded one must not clear a newer one's.
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
      }
    }
  }

  function separateRecording() {
    if (!recording) return;
    void start({
      key: async () => hashRef.current ?? (hashRef.current = await hashFile(recording)),
      title: recording.name,
      separate: async (c, onProgress, signal) => ({ jobId: await c.separate(recording, { onProgress, signal }) }),
    });
  }

  function importResult(item: SearchItem) {
    void start({
      key: async () => `url:${item.url}`,
      title: item.title,
      separate: (c, onProgress, signal) => c.separateUrl(item.url, { onProgress, signal }),
    });
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    setError(null);
    setSearching(true);
    try {
      setResults(await client.search(query));
    } catch (err) {
      setResults(null);
      setError(err instanceof Error ? err.message : 'The search failed.');
    } finally {
      setSearching(false);
    }
  }

  function change(update: (current: MixState) => MixState) {
    const next = update(mixRef.current);
    mixRef.current = next;
    onMixChange(next);
    active?.clock.setMix(next);
  }

  return (
    <div className="stems" role="group" aria-label="Stems">
      {!active && control.visible && (
        <div className="stems-row">
          <button type="button" disabled={control.disabled} onClick={separateRecording}>
            {control.label}
          </button>
          {busy && (
            <>
              <progress value={progress} max={1} aria-label="Separation progress" />
              <span className="muted">{busyLabel}</span>
              <button type="button" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            </>
          )}
          {bar.kind === 'determinate' && <progress value={bar.value} max={1} aria-label="Setup progress" />}
          {bar.kind === 'indeterminate' && <progress aria-label="Setup progress" />}
          {control.note && <span className="muted">{control.note}</span>}
          {engine.canRetry && (
            <button type="button" onClick={() => void startEngineSetup().catch((e: unknown) => setError(String(e)))}>
              {engine.kind === 'blocked' ? 'Restart engine' : 'Set up'}
            </button>
          )}
        </div>
      )}
      {!active && youtube.search && (
        <form className="stems-row" onSubmit={(e) => void search(e)} role="search">
          <input
            type="search"
            value={query}
            placeholder="Search YouTube for a song"
            aria-label="Search YouTube for a song"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={busy || searching || query.trim().length < 2}>
            {searching ? 'Searching…' : 'Search'}
          </button>
          <span className="muted">Imports the audio and splits it into stems. Use only audio you have the right to use.</span>
        </form>
      )}
      {!active && youtube.results && results !== null && (
        <ul className="search-results" aria-label="Search results">
          {results.length === 0 && <li className="muted">No results.</li>}
          {results.map((item) => {
            const row = searchRow(item);
            return (
              <li key={item.url}>
                <button type="button" disabled={busy || row.disabled} onClick={() => importResult(item)}>
                  Use
                </button>
                <span className="result-title">{row.title}</span>
                <span className="muted">{[row.detail, row.note].filter(Boolean).join(' · ')}</span>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {active && (
        <div className="stem-mixer">
          <div className="stems-row">
            <span className="muted">{active.title}</span>
            <label className="guitar-amount">
              Guitar amount
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={guitarAmount(mix)}
                aria-label="Guitar amount"
                onChange={(e) => change((m) => setGuitarAmount(m, Number(e.target.value)))}
              />
              <span className="stem-level">{guitarAmountLabel(guitarAmount(mix))}</span>
            </label>
            <button type="button" onClick={() => change((m) => toggleStemMute(m, 'guitar'))} aria-pressed={mix.guitar.muted}>
              {mix.guitar.muted ? 'Unmute guitar' : 'Mute guitar'}
            </button>
            <button type="button" onClick={() => change(() => initialMix())}>
              Reset mix
            </button>
            <button type="button" onClick={() => onActivate(null)}>
              {recording ? 'Back to the plain recording' : 'Close stems'}
            </button>
          </div>
          {STEM_NAMES.map((name: StemName) => (
            <div className="stem-row" key={name}>
              <span className="stem-name">{name}</span>
              <input
                type="range"
                min={0}
                max={MAX_STEM_VOLUME}
                step={0.01}
                value={mix[name].volume}
                aria-label={`${name} volume`}
                title="Double-click to reset to 100%"
                onChange={(e) => change((m) => setStemVolume(m, name, Number(e.target.value)))}
                onDoubleClick={() => change((m) => setStemVolume(m, name, 1))}
              />
              <span className="stem-level">{volumeLabel(mix[name].volume)}</span>
              <button type="button" aria-pressed={mix[name].muted} onClick={() => change((m) => toggleStemMute(m, name))}>
                M
              </button>
              <button type="button" aria-pressed={mix[name].solo} onClick={() => change((m) => toggleStemSolo(m, name))}>
                S
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
