import { useEffect, useRef, type PointerEvent } from 'react';
import type { Clock } from '../audio/clock';
import type { Timeline } from '../model/score';
import type { LoopBars } from '../render/tab-strip';
import { barAtPointer } from './panel-draw';

interface BarSelectOptions {
  timeline: Timeline;
  trackIndex: number;
  clock: Clock;
  onLoopChange: (loop: LoopBars | null) => void;
  /** Called when a bar is clicked without dragging: seek to the start of that score bar. */
  onSeekBar: (scoreBar: number) => void;
  /** A change here drops a drag in progress, since the canvas that owned it may be gone. */
  resetKey: unknown;
}

/** Click a bar to jump there, drag across bars to loop them: pointer handlers for the tab strip or the bar strip. */
export function useBarSelect({ timeline, trackIndex, clock, onLoopChange, onSeekBar, resetKey }: BarSelectOptions) {
  const drag = useRef<{ anchorBar: number; moved: boolean } | null>(null);
  useEffect(() => {
    drag.current = null;
  }, [resetKey]);

  return (kind: 'tab' | 'bar') => {
    const barOf = (e: PointerEvent<HTMLCanvasElement>) => barAtPointer(kind, e.currentTarget, e.clientX, timeline, trackIndex, clock.time());
    const end = () => {
      const d = drag.current;
      drag.current = null;
      if (d && !d.moved) onSeekBar(d.anchorBar);
    };
    return {
      onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
        const bar = barOf(e);
        if (bar === null) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { anchorBar: bar, moved: false };
      },
      onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
        const d = drag.current;
        if (!d) return;
        const bar = barOf(e);
        if (bar === null) return;
        if (bar !== d.anchorBar) d.moved = true;
        if (d.moved) onLoopChange({ startBar: Math.min(d.anchorBar, bar), endBar: Math.max(d.anchorBar, bar) });
      },
      onPointerUp: end,
      onPointerCancel: end,
    };
  };
}
