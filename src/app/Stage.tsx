import { useEffect, useRef, useState } from 'react';
import type { Clock } from '../audio/clock';
import { playbackBarIndexAt } from '../model/bars';
import type { Timeline } from '../model/score';
import type { LabelMode } from '../render/fretboard';
import type { LoopBars } from '../render/tab-strip';
import { NeckCalibration } from './NeckCalibration';
import { drawSurface, surfaceLabel, type SurfaceKind, withMoment } from './panel-draw';
import { isGuitarPanel, needsBarStrip, panelsOf, PANEL_NAMES, type PanelId, type StageLayout } from './stage-layout';
import { useBarSelect } from './use-bar-select';
import { useNeckPhoto } from './use-neck-photo';
import { usePickPhoto } from './use-pick-photo';

interface StageProps {
  timeline: Timeline;
  trackIndex: number;
  clock: Clock;
  /** Which panels are on the page. */
  layout: StageLayout;
  /** Upcoming steps the fretboard and the real guitar show. */
  lookahead: number;
  /** What the dots say. */
  labelMode: LabelMode;
  /** Whether the real guitar draws technique cues. */
  neckCues: boolean;
  onNeckCuesChange: (on: boolean) => void;
  loop: LoopBars | null;
  onLoopChange: (loop: LoopBars | null) => void;
  /** Called when the strip is clicked without dragging: seek to the start of a score bar. */
  onSeekBar: (scoreBar: number) => void;
  /** Called every frame so the parent can follow the clock (play state, time readout). */
  onFrame: (t: number) => void;
  onFullscreen: (panel: PanelId) => void;
}

export function Stage({
  timeline,
  trackIndex,
  clock,
  layout,
  lookahead,
  labelMode,
  neckCues,
  onNeckCuesChange,
  loop,
  onLoopChange,
  onSeekBar,
  onFrame,
  onFullscreen,
}: StageProps) {
  const canvases = useRef<Partial<Record<SurfaceKind, HTMLCanvasElement | null>>>({});
  const photo = useNeckPhoto();
  const bassPhoto = useNeckPhoto('bass');
  const pickPhoto = usePickPhoto();
  const [calibrating, setCalibrating] = useState(false);
  const panels = panelsOf(layout);
  const bar = needsBarStrip(panels);
  const key = `${layout.top}/${layout.bottom}`;
  const liveRef = useRef({ loop, lookahead, labelMode, neckCues });
  liveRef.current = { loop, lookahead, labelMode, neckCues };
  const barSelect = useBarSelect({ timeline, trackIndex, clock, onLoopChange, onSeekBar, resetKey: key });

  useEffect(() => {
    let frame = 0;
    let lastBar = -1;
    const draw = () => {
      const t = clock.time();
      const live = liveRef.current;
      // One moment per frame, handed to every surface so they all agree on what is sounding.
      const state = withMoment({ timeline, trackIndex, t, loop: live.loop, lookahead: live.lookahead, labelMode: live.labelMode, neckCues: live.neckCues, photo: photo.current, bassPhoto: bassPhoto.current, pickPhoto: pickPhoto.current });
      const playbackBar = playbackBarIndexAt(timeline, t);
      const relabel = playbackBar !== lastBar;
      lastBar = playbackBar;
      for (const kind of Object.keys(canvases.current) as SurfaceKind[]) {
        const canvas = canvases.current[kind];
        if (!canvas) continue;
        drawSurface(kind, canvas, state);
        if (relabel) canvas.setAttribute('aria-label', surfaceLabel(kind, timeline, trackIndex, playbackBar));
      }
      onFrame(t);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [timeline, trackIndex, clock, onFrame, photo, bassPhoto, pickPhoto]);

  function panel(id: PanelId) {
    const seekable = id === 'tab';
    return (
      <div className="stage-panel" key={id}>
        <canvas
          ref={(el) => {
            canvases.current[id] = el;
          }}
          className={`panel-canvas panel-${id}`}
          role="img"
          aria-label={PANEL_NAMES[id]}
          title={seekable ? 'Click a bar to jump there, drag across bars to loop them' : undefined}
          {...(seekable ? barSelect('tab') : {})}
        />
        <div className="panel-tools">
          {isGuitarPanel(id) && (
            <button
              type="button"
              aria-pressed={neckCues}
              onClick={() => onNeckCuesChange(!neckCues)}
              title="Show how each note is played: hammer-ons, slides, bends and more"
            >
              Techniques {neckCues ? 'on' : 'off'}
            </button>
          )}
          {id === 'pick' && (
            <button type="button" onClick={() => setCalibrating(true)} title="Use a photo of your own guitar">
              Photo
            </button>
          )}
          <button type="button" onClick={() => onFullscreen(id)} aria-label={`Full screen ${PANEL_NAMES[id]}`} title={`Full screen ${PANEL_NAMES[id]}`}>
            ⤢
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      {panels.map(panel)}
      {bar && (
        <canvas
          ref={(el) => {
            canvases.current.bar = el;
          }}
          className="panel-canvas bar-timeline"
          role="img"
          aria-label="Bar timeline"
          title="Click a bar to jump there, drag across bars to loop them"
          {...barSelect('bar')}
        />
      )}
      {calibrating && <NeckCalibration onClose={() => setCalibrating(false)} />}
    </div>
  );
}
