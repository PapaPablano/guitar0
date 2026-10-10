import { useState, type ReactNode } from 'react';
import { isDesktop } from './desktop';
import { chooseMethod, methodsFor, type BackingMethod } from './backing-track';
import { describeEngine, startEngineSetup, type ShellEngineStatus } from './engine-state';
import { readYoutubeFlag } from './feature-flags';
import { useEngineStatus } from './use-engine-status';

interface BackingTrackProps {
  /** Loading a file by hand: the recording loader. */
  recording: ReactNode;
  /** The stem controls, given the engine's status and the chosen method. Always drawn, so a separation keeps running. */
  stems: (context: { status: ShellEngineStatus | null; method: BackingMethod }) => ReactNode;
}

const METHOD_LABELS: Record<BackingMethod, string> = { file: 'Load a file', youtube: 'Search YouTube' };

/** One place to get a backing track: load a file, or (desktop, YouTube option on) search YouTube, then split and mix the stems. */
export function BackingTrack({ recording, stems }: BackingTrackProps) {
  const status = useEngineStatus();
  const [method, setMethod] = useState<BackingMethod>('file');
  const [error, setError] = useState<string | null>(null);
  const methods = methodsFor({ desktop: isDesktop(), youtube: readYoutubeFlag() });

  function choose(next: BackingMethod) {
    const { method: chosen, startSetup } = chooseMethod(next, describeEngine(status));
    setMethod(chosen);
    setError(null);
    if (startSetup) startEngineSetup().catch((e: unknown) => setError(String(e)));
  }

  return (
    <div className="backing-track" role="group" aria-label="Backing track">
      {methods.length > 1 && (
        <div className="stems-row backing-methods" role="group" aria-label="How to get a backing track">
          {methods.map((m) => (
            <button key={m} type="button" aria-pressed={m === method} onClick={() => choose(m)}>
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {recording}
      {stems({ status, method })}
    </div>
  );
}
