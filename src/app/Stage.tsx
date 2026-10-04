import { useEffect, useRef } from 'react';
import { renderFretboard } from '../render/fretboard';
import { barAtX, getBarTimelineLayout, renderBarTimeline } from '../render/bar-timeline';
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
import type { BottomView } from './ViewControls';

interface StageProps {
  timeline: Timeline;
  trackIndex: number;
  clock: Clock;
  /** Which view fills the bottom panel. */
  bottomView: BottomView;
  /** Upcoming steps the fretboard shows. */
  lookahead: number;
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

export function Stage({
  timeline,
  trackIndex,
  clock,
  bottomView,
  lookahead,
  loop,
  onLoopChange,
  onSeekBar,
  onFrame,
}: StageProps) {
  const highwayRef = useRef<HTMLCanvasElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const fretboardRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLCanvasElement>(null);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const lookaheadRef = useRef(lookahead);
  lookaheadRef.current = lookahead;
  const dragRef = useRef<{ anchorBar: number; moved: boolean } | null>(null);

  useEffect(() => {
    let frame = 0;
    let lastBar = -1;
    const draw = () => {
      const t = clock.time();
      const highway = highwayRef.current;
      const strip = stripRef.current;
      const fretboard = fretboardRef.current;
      const barTimeline = timelineRef.current;
      if (highway) {
        const fit = fitCanvas(highway);
        if (fit) renderHighway(fit.ctx, timeline, trackIndex, t, fit.width, fit.height);
        const bar = playbackBarIndexAt(timeline, t);
        if (bar !== lastBar) {
          lastBar = bar;
          const label = `Highway, bar ${timeline.bars[bar]?.scoreBar + 1} of ${timeline.scoreBarCount}, track ${timeline.tracks[trackIndex]?.name || trackIndex + 1}`;
          highway.setAttribute('aria-label', label);
          strip?.setAttribute('aria-label', label.replace('Highway', 'Tab strip'));
          fretboardRef.current?.setAttribute('aria-label', label.replace('Highway', 'Fretboard'));
          timelineRef.current?.setAttribute('aria-label', label.replace('Highway', 'Bar timeline'));
        }
      }
      if (strip) {
        const fit = fitCanvas(strip);
        if (fit) renderTabStrip(fit.ctx, timeline, trackIndex, t, fit.width, fit.height, { loop: loopRef.current });
      }
      if (fretboard) {
        const fit = fitCanvas(fretboard);
        if (fit) renderFretboard(fit.ctx, timeline, trackIndex, t, fit.width, fit.height, { lookahead: lookaheadRef.current });
      }
      if (barTimeline) {
        const fit = fitCanvas(barTimeline);
        if (fit) renderBarTimeline(fit.ctx, timeline, t, fit.width, fit.height, { loop: loopRef.current });
      }
      onFrame(t);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [timeline, trackIndex, clock, onFrame, bottomView]);

  function barFromEvent(e: React.PointerEvent<HTMLCanvasElement>): number | null {
    const canvas = bottomView === 'fretboard' ? timelineRef.current : stripRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const x = e.clientX - rect.left;
    if (bottomView === 'fretboard') return barAtX(getBarTimelineLayout(timeline, width, height), x);
    return scoreBarAtX(getStripLayout(timeline, trackIndex, width, height), timeline, clock.time(), x);
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
      {bottomView === 'tab' ? (
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
      ) : (
        <>
          <canvas ref={fretboardRef} className="fretboard" role="img" aria-label="Fretboard" />
          <canvas
            ref={timelineRef}
            className="bar-timeline"
            role="img"
            aria-label="Bar timeline"
            title="Click a bar to jump there, drag across bars to loop them"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </>
      )}
    </div>
  );
}
