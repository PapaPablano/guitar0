import { useEffect, useRef } from 'react';
import type { Clock } from '../audio/clock';
import { playbackBarIndexAt } from '../model/bars';
import type { Timeline } from '../model/score';
import type { LabelMode } from '../render/fretboard';
import type { LoopBars } from '../render/tab-strip';
import { drawSurface, surfaceLabel } from './panel-draw';
import { PANEL_NAMES, type PanelId } from './stage-layout';
import { useBarSelect } from './use-bar-select';
import { useNeckPhoto } from './use-neck-photo';

interface PanelFullscreenProps {
  panel: PanelId;
  timeline: Timeline;
  trackIndex: number;
  clock: Clock;
  lookahead: number;
  labelMode: LabelMode;
  /** Whether technique cues are drawn on the real guitar. */
  neckCues: boolean;
  onNeckCuesChange: (on: boolean) => void;
  loop: LoopBars | null;
  onLoopChange: (loop: LoopBars | null) => void;
  onSeekBar: (scoreBar: number) => void;
  playing: boolean;
  canPlay: boolean;
  onTogglePlay: () => void;
  onClose: () => void;
}

/**
 * Any one panel filling the whole screen: tap to play or pause (on the tab strip a tap jumps to a bar instead, and Space plays),
 * Esc or the close button to leave; the app's own keys (space, arrows) keep working.
 * It asks the browser for real full screen, and closes itself when the player leaves that some other way.
 * The fretboard keeps a slim bar strip along the bottom so seeking and looping still work.
 */
export function PanelFullscreen({
  panel,
  timeline,
  trackIndex,
  clock,
  lookahead,
  labelMode,
  neckCues,
  onNeckCuesChange,
  loop,
  onLoopChange,
  onSeekBar,
  playing,
  canPlay,
  onTogglePlay,
  onClose,
}: PanelFullscreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLCanvasElement>(null);
  const photo = useNeckPhoto();
  const liveRef = useRef({ loop, lookahead, labelMode, neckCues });
  liveRef.current = { loop, lookahead, labelMode, neckCues };
  const barSelect = useBarSelect({ timeline, trackIndex, clock, onLoopChange, onSeekBar, resetKey: panel });
  const withBar = panel === 'fretboard';
  const seekable = panel === 'tab';

  useEffect(() => {
    const root = rootRef.current;
    // Keys must reach the page, not the button that opened this view (Space on a focused button is left to the button).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root?.focus();
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
      opener?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let frame = 0;
    let lastBar = -1;
    const draw = () => {
      const t = clock.time();
      const live = liveRef.current;
      const state = { timeline, trackIndex, t, loop: live.loop, lookahead: live.lookahead, labelMode: live.labelMode, neckCues: live.neckCues, photo: photo.current };
      const playbackBar = playbackBarIndexAt(timeline, t);
      const relabel = playbackBar !== lastBar;
      lastBar = playbackBar;
      for (const [kind, canvas] of [[panel, mainRef.current], ['bar', barRef.current]] as const) {
        if (!canvas) continue;
        drawSurface(kind, canvas, state);
        if (relabel) canvas.setAttribute('aria-label', surfaceLabel(kind, timeline, trackIndex, playbackBar));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [timeline, trackIndex, clock, panel, photo]);

  const name = PANEL_NAMES[panel];
  return (
    <div ref={rootRef} tabIndex={-1} className="panel-fullscreen" role="dialog" aria-label={`Full screen ${name}`}>
      <canvas
        ref={mainRef}
        role="img"
        aria-label={name}
        title={seekable ? 'Click a bar to jump there, drag across bars to loop them' : undefined}
        onClick={seekable ? undefined : () => canPlay && onTogglePlay()}
        {...(seekable ? barSelect('tab') : {})}
      />
      {withBar && (
        <canvas
          ref={barRef}
          className="bar-timeline"
          role="img"
          aria-label="Bar timeline"
          title="Click a bar to jump there, drag across bars to loop them"
          {...barSelect('bar')}
        />
      )}
      {panel === 'neck' && (
        <button
          type="button"
          className="panel-fullscreen-cues"
          aria-pressed={neckCues}
          onClick={() => onNeckCuesChange(!neckCues)}
          title="Show how each note is played: hammer-ons, slides, bends and more"
        >
          Techniques {neckCues ? 'on' : 'off'}
        </button>
      )}
      <button type="button" className="panel-fullscreen-close" onClick={onClose} aria-label="Exit full screen">
        ✕
      </button>
      {!playing && canPlay && (
        <p className="panel-fullscreen-hint" style={withBar ? { bottom: 76 } : undefined}>
          {seekable ? 'Press space to play' : 'Tap or press space to play'} · Esc to exit
        </p>
      )}
    </div>
  );
}
