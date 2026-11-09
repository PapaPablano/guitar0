import { useState, type ReactNode } from 'react';
import { methodsFor, type BackingMethod } from './backing-track';
import type { ShellEngineStatus } from './engine-state';
import { readYoutubeFlag } from './feature-flags';
import { useTier } from './tier';
import { useEngineStatus } from './use-engine-status';
import { videoOffered } from './youtube-backing';

interface BackingTrackProps {
  /** Loading a file by hand: the recording loader. */
  recording: ReactNode;
  /** The stem controls, given the engine's status and the chosen method. Always drawn, so a separation keeps running. */
  stems: (context: { status: ShellEngineStatus | null; method: BackingMethod }) => ReactNode;
  /** The YouTube video controls, drawn when the player chooses a video. */
  video: ReactNode;
  /** Whether a video is attached, so the section opens on it. */
  videoAttached: boolean;
}

const METHOD_LABELS: Record<BackingMethod, string> = { file: 'Load a file', video: 'Use a YouTube video' };

/** One place to get a backing track: load a file and split it into stems, or play along with a YouTube video. */
export function BackingTrack({ recording, stems, video, videoAttached }: BackingTrackProps) {
  const status = useEngineStatus();
  /** The player's own choice; until they make one, an attached video opens on its controls. */
  const [chosen, setChosen] = useState<BackingMethod | null>(null);
  const tier = useTier();
  const methods = methodsFor({ video: videoOffered(readYoutubeFlag(), tier) });
  const method: BackingMethod = chosen && methods.includes(chosen) ? chosen : videoAttached && methods.includes('video') ? 'video' : 'file';

  return (
    <div className="backing-track" role="group" aria-label="Backing track">
      {methods.length > 1 && (
        <div className="stems-row backing-methods" role="group" aria-label="How to get a backing track">
          {methods.map((m) => (
            <button key={m} type="button" aria-pressed={m === method} onClick={() => setChosen(m)}>
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
      )}
      {/* Both stay mounted so a running separation or an attached video is not lost when the player switches. */}
      <div hidden={method !== 'file'}>
        {recording}
        {stems({ status, method })}
      </div>
      <div hidden={method !== 'video'}>{video}</div>
    </div>
  );
}
