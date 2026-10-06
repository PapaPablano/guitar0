import { useEffect, useRef } from 'react';
import type { Clock } from '../audio/clock';
import type { LabelMode } from '../render/fretboard';
import { drawNeckPhoto, renderNeckView, zoomedPlacement } from '../render/neck-view';
import photoUrl from '../assets/guitar-photo.jpg';
import type { Timeline } from '../model/score';

interface NeckFullscreenProps {
  timeline: Timeline;
  trackIndex: number;
  clock: Clock;
  lookahead: number;
  labelMode: LabelMode;
  /** Whether technique cues are drawn on the neck. */
  neckCues: boolean;
  onNeckCuesChange: (on: boolean) => void;
  playing: boolean;
  canPlay: boolean;
  onTogglePlay: () => void;
  onClose: () => void;
}

/**
 * The real guitar's neck filling the whole screen, with the rings drawn over its photo: tap anywhere to play or pause, Esc or the close button to leave; the app's own keys (space, arrows) keep working.
 * It asks the browser for real full screen, and closes itself when the player leaves that some other way.
 */
export function NeckFullscreen({
  timeline,
  trackIndex,
  clock,
  lookahead,
  labelMode,
  neckCues,
  onNeckCuesChange,
  playing,
  canPlay,
  onTogglePlay,
  onClose,
}: NeckFullscreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLImageElement | null>(null);
  const lookaheadRef = useRef(lookahead);
  lookaheadRef.current = lookahead;
  const labelModeRef = useRef(labelMode);
  labelModeRef.current = labelMode;
  const neckCuesRef = useRef(neckCues);
  neckCuesRef.current = neckCues;

  useEffect(() => {
    const root = rootRef.current;
    let entered = false;
    // A browser can refuse (or lack) full screen; the overlay still covers the window then.
    root?.requestFullscreen?.().then(
      () => {
        entered = true;
      },
      () => undefined,
    );
    const onChange = () => {
      if (entered && !document.fullscreenElement) onClose();
    };
    document.addEventListener('fullscreenchange', onChange);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [onClose]);

  useEffect(() => {
    const image = new Image();
    image.src = photoUrl;
    image.onload = () => {
      photoRef.current = image;
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const time = clock.time();
          drawNeckPhoto(ctx, photoRef.current, width, height, zoomedPlacement(width, height, timeline.notesForTrack(trackIndex), time, timeline.tracks[trackIndex]?.stringCount));
          renderNeckView(ctx, timeline, trackIndex, time, width, height, {
            zoom: true,
            lookahead: lookaheadRef.current,
            labelMode: labelModeRef.current,
            techniqueCues: neckCuesRef.current,
          });
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [timeline, trackIndex, clock]);

  return (
    <div ref={rootRef} className="neck-fullscreen" role="dialog" aria-label="Full screen neck">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Guitar neck"
        onClick={() => {
          if (canPlay) onTogglePlay();
        }}
      />
      <button
        type="button"
        className="neck-fullscreen-cues"
        aria-pressed={neckCues}
        onClick={() => onNeckCuesChange(!neckCues)}
        title="Show how each note is played: hammer-ons, slides, bends and more"
      >
        Techniques {neckCues ? 'on' : 'off'}
      </button>
      <button type="button" className="neck-fullscreen-close" onClick={onClose} aria-label="Exit full screen">
        ✕
      </button>
      {!playing && canPlay && <p className="neck-fullscreen-hint">Tap or press space to play · Esc to exit</p>}
    </div>
  );
}
