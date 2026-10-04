import { useEffect, useRef } from 'react';
import { renderHighway } from '../render/highway';
import {
  getStripLayout,
  renderTabStrip,
  scoreBarAtX,
  type LoopBars,
} from '../render/tab-strip';
import { playbackBarIndexAt } from '../model/bars';
import type { Clock } from '../audio/clock';
import type { Timeline } from '../model/score';

interface StageProps {
  timeline: Timeline;
  trackIndex: number;
  clock: Clock;
  loop: LoopBars | null;
  onLoopChange: (loop: LoopBars | null) => void;
  /** Called when the strip is clicked without dragging: seek to the start of a score bar. */
  onSeekBar: (scoreBar: number) => void;
  /** Called every frame so the parent can follow the clock (play state, time readout). */
  onFrame: (t: number) => void;
}

/** Sizes a canvas to its CSS box at the device pixel ratio and returns its 2D context. */
function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

export function Stage({ timeline, trackIndex, clock, loop, onLoopChange, onSeekBar, onFrame }: StageProps) {
  const highwayRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const dragRef = useRef<{ anchorBar: number; moved: boolean } | null>(null);

  useEffect(() => {
    let frame = 0;
    let lastBar = -1;
    const draw = () => {
      const t = clock.time();
      const highway = highwayRef.current;
      const strip = stripRef.current;
      if (highway) {
        const fit = fitCanvas(highway);
        if (fit) renderHighway(fit.ctx, timeline, trackIndex, t, fit.width, fit.height);
        const bar = playbackBarIndexAt(timeline, t);
        if (bar !== lastBar) {
          lastBar = bar;
          const label = `Highway, bar ${timeline.bars[bar]?.scoreBar + 1} of ${timeline.scoreBarCount}, track ${timeline.tracks[trackIndex]?.name || trackIndex + 1}`;
          highway.setAttribute('aria-label', label);
          strip?.setAttribute('aria-label', label.replace('Highway', 'Tab strip'));
        }
      }
      if (strip) {
        const fit = fitCanvas(strip);
        if (fit) renderTabStrip(fit.ctx, timeline, trackIndex, t, fit.width, fit.height, { loop: loopRef.current });
      }
      onFrame(t);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [timeline, trackIndex, clock, onFrame]);

  function barFromEvent(e: React.PointerEvent<HTMLCanvasElement>): number | null {
    const canvas = stripRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const layout = getStripLayout(timeline, trackIndex, Math.round(rect.width), Math.round(rect.height));
    return scoreBarAtX(layout, timeline, clock.time(), e.clientX - rect.left);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const bar = barFromEvent(e);
    if (bar === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { anchorBar: bar, moved: false };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const bar = barFromEvent(e);
    if (bar === null) return;
    if (bar !== drag.anchorBar) drag.moved = true;
    if (drag.moved) {
      onLoopChange({ startBar: Math.min(drag.anchorBar, bar), endBar: Math.max(drag.anchorBar, bar) });
    }
  }

  function onPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) onSeekBar(drag.anchorBar);
  }

  return (
    <div className="stage">
      <canvas ref={highwayRef} className="highway" role="img" aria-label="Highway" />
      <canvas
        ref={stripRef}
        className="strip"
        role="img"
        aria-label="Tab strip"
        title="Click a bar to jump there, drag across bars to loop them"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
