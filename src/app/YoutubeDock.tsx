import { useEffect, useRef, useState } from 'react';
import { DOCK_HEIGHT_PX, DOCK_WIDTH_PX, dockRules, type AudioSource } from './youtube-dock';
import { mountPlayer, type EmbeddedPlayer } from './youtube-player';

interface YoutubeDockProps {
  videoId: string;
  source: AudioSource;
  /** Called with the player once it is ready, and with null when it goes away. */
  onPlayer: (player: EmbeddedPlayer | null) => void;
  /** The player reported a problem; the message is ready to show. */
  onError: (message: string) => void;
}

/**
 * The docked YouTube player. It sits above every view, including a full-screen panel, and cannot be hidden while the
 * video's own audio is playing; with the synth playing the video is muted and may be minimized.
 */
export function YoutubeDock({ videoId, source, onPlayer, onError }: YoutubeDockProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [minimized, setMinimized] = useState(false);
  const rules = dockRules(true, source);
  const hidden = minimized && rules.canMinimize;
  const handlers = useRef({ onPlayer, onError });
  handlers.current = { onPlayer, onError };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // The embed replaces the element it is given, so it gets one of its own that React does not manage.
    const target = document.createElement('div');
    frame.appendChild(target);
    let cancelled = false;
    let mounted: EmbeddedPlayer | null = null;
    mountPlayer(target, videoId, { onError: (message) => handlers.current.onError(message) }).then(
      (player) => {
        if (cancelled) {
          player.destroy();
          return;
        }
        mounted = player;
        handlers.current.onPlayer(player);
      },
      (e: unknown) => {
        if (!cancelled) handlers.current.onError(e instanceof Error ? e.message : 'The video could not be played.');
      },
    );
    return () => {
      cancelled = true;
      if (mounted) {
        // The clock lets go of the player before the player is destroyed, so it never calls a dead embed.
        handlers.current.onPlayer(null);
        mounted.destroy();
      }
      frame.replaceChildren();
    };
  }, [videoId]);

  return (
    <section className={`youtube-dock${hidden ? ' youtube-dock-minimized' : ''}`} aria-label="Original recording video" style={{ width: DOCK_WIDTH_PX }}>
      <div className="youtube-dock-bar">
        <span>{source === 'original' ? 'Original' : 'Synth (video muted)'}</span>
        <button
          type="button"
          onClick={() => setMinimized((on) => !on)}
          disabled={!rules.canMinimize}
          title={rules.canMinimize ? undefined : 'The video stays visible while the original audio plays'}
          aria-expanded={!hidden}
        >
          {hidden ? 'Show video' : 'Minimize'}
        </button>
      </div>
      <div ref={frameRef} className="youtube-dock-frame" style={{ height: hidden ? 0 : DOCK_HEIGHT_PX }} />
    </section>
  );
}
