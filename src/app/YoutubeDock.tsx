import { useEffect, useRef, useState, type PointerEvent } from 'react';
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
 * video's own audio is playing; with the synth playing the video is muted and may be minimized. Its title bar drags it
 * to another corner, never off screen.
 */
export function YoutubeDock({ videoId, source, onPlayer, onError }: YoutubeDockProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const [minimized, setMinimized] = useState(false);
  // Null keeps the default bottom-right corner from the stylesheet.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
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

  const clamp = (x: number, y: number) => {
    const rect = dockRef.current?.getBoundingClientRect();
    const w = rect?.width ?? DOCK_WIDTH_PX;
    const h = rect?.height ?? DOCK_HEIGHT_PX;
    return { x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)), y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h)) };
  };

  // A resized window must not strand the dock off screen.
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || !dockRef.current) return;
    const rect = dockRef.current.getBoundingClientRect();
    grab.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (grab.current) setPos(clamp(e.clientX - grab.current.dx, e.clientY - grab.current.dy));
  };
  const endDrag = () => { grab.current = null; };

  return (
    <section ref={dockRef} className={`youtube-dock${hidden ? ' youtube-dock-minimized' : ''}`} aria-label="Original recording video" style={pos ? { width: DOCK_WIDTH_PX, left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : { width: DOCK_WIDTH_PX }}>
      <div className="youtube-dock-bar" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
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
