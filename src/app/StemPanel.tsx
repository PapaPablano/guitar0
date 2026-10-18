import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { initialMix, MAX_STEM_VOLUME, type MixState } from '../audio/mix-gains';
import type { StemMixClock } from '../audio/stem-mix';
import type { StemSources } from '../export/stem-audio';
import { EngineClient, SeparationCancelled, STEM_NAMES, type SearchItem, type StemName } from '../stems/engine-client';
import { hashFile } from '../stems/file-hash';
import { audioContext, loadStems } from '../stems/load-stems';
import { createRunGuard } from '../stems/run-guard';
import { SavedStems, shellStemIndex } from '../stems/saved-stems';
import type { BackingMethod } from './backing-track';
import { isDesktop } from './desktop';
import { stepAfterJudge, stepAfterPrecheck, TAKE_CHECKING_LABEL, type TakeJudged, type TakeOpenDecision, type TakeStep } from './take-align';
import { readYoutubeFlag, youtubeControls } from './feature-flags';
import { isPro, useTier, youtubeAllowed } from './tier';
import { describeEngine, engineStateLine, setupBar, startEngineSetup, type ShellEngineStatus } from './engine-state';
import { guitarAmount, guitarAmountLabel, passNote, scheduleForChoice, SCHEDULE_CHOICES, type ScheduleChoice, rankByLength, searchRow, setGuitarAmount, separateControl, setStemVolume, toggleStemMute, toggleStemSolo, volumeLabel } from './stem-controls';

export interface ActiveStems {
  readonly clock: StemMixClock;
  readonly sources: StemSources;
  /** What the stems came from: the recording's file name or the video's title. */
  readonly title: string;
  /** Set only for a take imported from YouTube: the video's link, so the take, not the loaded recording, owns its alignment. */
  readonly videoUrl?: string;
  /** For a take: the offset it was judged to line up by (or remembered as), in seconds. */
  readonly takeOffset?: number;
}

/** What the app lends the panel to judge a YouTube take against the tab before it is switched on. */
export interface TakeChecks {
  /** Before any download: what is remembered for this video and the tab as it is now. */
  precheck(videoUrl: string): Promise<TakeOpenDecision>;
  /** After the stems load: compares them with the tab. `takeSeconds` is the stems' own length. */
  judge(sources: StemSources, videoUrl: string, takeSeconds: number, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<TakeJudged>;
  /** Forgets a remembered no-match so the next import checks again. */
  forget(videoUrl: string): Promise<void>;
}

interface StemPanelProps {
  /** The desktop shell's report on setup and the engine, from the Backing track section. */
  status: ShellEngineStatus | null;
  /** The way the player chose to get a backing track; the YouTube search shows only for 'youtube'. */
  method: BackingMethod;
  recording: File | null;
  durationSeconds: number;
  active: ActiveStems | null;
  mix: MixState;
  onMixChange: (mix: MixState) => void;
  onActivate: (stems: ActiveStems | null) => void;
  /** Judges a YouTube take before it plays; without it a take is switched on as it is. */
  takes?: TakeChecks;
}

const savedStems = new SavedStems(shellStemIndex);

/** Where a separation's stems come from, and how to produce them when they are not saved yet. */
interface Source {
  /** Key in the saved-stems index. */
  key: () => Promise<string>;
  title: string;
  /** Set for a YouTube take, which is judged against the tab before it is switched on. */
  item?: SearchItem;
  separate: (client: EngineClient, onProgress: (p: number) => void, signal: AbortSignal) => Promise<{ jobId: string; title?: string }>;
}

/** Search, separate and mix controls. Renders nothing outside the desktop app. */
export function StemPanel({ status, method, recording, durationSeconds, active, mix, onMixChange, onActivate, takes }: StemPanelProps) {
  const desktop = isDesktop();
  const tier = useTier();
  const [savedJob, setSavedJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Why the latest take was not switched on, with the result to check again when that is possible. */
  const [takeNote, setTakeNote] = useState<{ text: string; again: SearchItem | null } | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [scheduleChoice, setScheduleChoice] = useState<ScheduleChoice>('off');
  const [pass, setPass] = useState(1);
  const abort = useRef<AbortController | null>(null);
  const runs = useRef(createRunGuard());
  const hashRef = useRef<string | null>(null);
  /** The newest mix, so two quick changes in a row build on each other instead of on a stale render. */
  const mixRef = useRef(mix);
  mixRef.current = mix;

  /** The per-pass schedule follows the active stems; leaving them puts the base mix back. */
  useEffect(() => {
    if (!active) return;
    const clock = active.clock;
    clock.setSchedule(scheduleForChoice(scheduleChoice));
    setPass(clock.pass);
    const stop = clock.onPassChange(() => setPass(clock.pass));
    return () => {
      stop();
      clock.setSchedule({ kind: 'off' });
    };
  }, [active, scheduleChoice]);

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

  const engine = describeEngine(status, !isPro(tier));
  const bar = setupBar(engine);
  const control = separateControl({ engine, hasRecording: recording !== null, hasSaved: savedJob !== null, busy });
  const youtube = youtubeControls({ enabled: readYoutubeFlag() && youtubeAllowed(tier), stemsEnabled: engine.stemsEnabled, hasResults: results !== null });

  /** Separates (or reuses saved stems for) a source, then plays them. */
  async function start(source: Source) {
    if (!client) return;
    setError(null);
    setTakeNote(null);
    setBusy(true);
    setBusyLabel(source.title);
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    const run = runs.current.begin();
    const stale = () => !runs.current.isCurrent(run) || controller.signal.aborted;
    try {
      let takeOffset: number | null = null;
      if (source.item && takes) {
        // A remembered no-match is shown without downloading anything; a remembered offset skips only the check.
        const first = stepAfterPrecheck(await takes.precheck(source.item.url));
        if (stale()) return;
        if (first.step === 'show') {
          showTakeNote(first, source.item);
          return;
        }
        if (first.step === 'load') takeOffset = first.offset;
      }
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
      if (source.item && takes) {
        // The take is judged before it is switched on, so a take that does not line up never plays (KD1).
        let offset = takeOffset;
        if (offset === null) {
          setBusyLabel(TAKE_CHECKING_LABEL);
          setProgress(0);
          const next = stepAfterJudge(await takes.judge(loaded.sources, source.item.url, loaded.clock.mediaSeconds, setProgress, controller.signal));
          if (stale() || next.step !== 'activate') {
            loaded.clock.dispose();
            if (!stale() && next.step === 'show') showTakeNote(next, source.item);
            if (!stale() && next.step === 'error') setError(next.text);
            return;
          }
          offset = next.offset;
        }
        onActivate({ ...loaded, title, videoUrl: source.item.url, takeOffset: offset });
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
    if (control.startsSetup) {
      startEngineSetup().catch((e: unknown) => setError(String(e)));
      return;
    }
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
      item,
      separate: (c, onProgress, signal) => c.separateUrl(item.url, { onProgress, signal }),
    });
  }

  /** Says why a take was not switched on; a remembered no-match also offers to check the result again. */
  function showTakeNote(step: Extract<TakeStep, { step: 'show' }>, item: SearchItem) {
    setTakeNote({ text: step.text, again: step.canRecheck ? item : null });
  }

  /** Forgets a remembered no-match, then imports the result again so the take is judged afresh. */
  async function checkAgain(item: SearchItem) {
    await takes?.forget(item.url).catch(() => undefined);
    importResult(item);
  }

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    setError(null);
    setTakeNote(null);
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
      {!active && method === 'youtube' && youtube.search && (
        <form className="stems-row" onSubmit={(e) => void search(e)} role="search">
          <input
            type="search"
            value={query}
            placeholder="Search YouTube for a song"
            aria-label="Search YouTube for a song"
            disabled={!youtube.searchUsable}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" disabled={!youtube.searchUsable || busy || searching || query.trim().length < 2}>
            {searching ? 'Searching…' : 'Search'}
          </button>
          <span className="muted">
            {youtube.searchUsable ? 'Imports the audio and splits it into stems. Use only audio you have the right to use.' : engineStateLine(engine)}
          </span>
        </form>
      )}
      {!active && method === 'youtube' && youtube.results && results !== null && (
        <ul className="search-results" aria-label="Search results">
          {results.length === 0 && <li className="muted">No results.</li>}
          {rankByLength(results, durationSeconds).map((item) => {
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
      {!active && takeNote && (
        <p role="status" className="notice">
          {takeNote.text}{' '}
          {takeNote.again && (
            <button type="button" disabled={busy} onClick={() => void checkAgain(takeNote.again as SearchItem)}>
              Check again
            </button>
          )}
        </p>
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
            <label className="pass-schedule">
              Each loop pass
              <select
                value={scheduleChoice}
                aria-label="Mix change per loop pass"
                onChange={(e) => setScheduleChoice(e.target.value as ScheduleChoice)}
              >
                {SCHEDULE_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {scheduleChoice !== 'off' && (
              <span className="muted">{active.clock.loop ? passNote(scheduleForChoice(scheduleChoice), pass) : 'Set a loop to use this.'}</span>
            )}
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
