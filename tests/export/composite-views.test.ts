import { describe, expect, it } from 'vitest';
import type { StartMessage } from '../../src/export/encoder.worker';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { startExport } from '../../src/export/exporter';
import { presetById } from '../../src/export/presets';
import type { PanelId } from '../../src/app/stage-layout';
import { computeNeck, renderFretboard } from '../../src/render/fretboard';
import { maxFretUsed } from '../../src/render/fretboard-steps';
import { frameLayout, renderStageFrame, type ExportViewOptions, type FrameContext } from '../../src/render/stage-frame';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1920;
const H = 1080;

const specs: NoteSpec[] = [1, 2, 3, 4, 5, 6, 7].map((s, i) => ({
  start: s,
  end: s + 0.5,
  string: 1 + (i % 6),
  fret: 2 + i,
}));
const timeline = makeTimeline(specs, 2, 6);

function frame(t: number, panels: PanelId[], view: ExportViewOptions = { lookahead: 4 }, w = W, h = H, photo: unknown = null): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderStageFrame(ctx as unknown as FrameContext, timeline, 0, t, w, h, panels, { ...view, photo: photo as CanvasImageSource | null });
  return calls;
}

const dashed = (calls: Call[]) => calls.filter((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0);
const translates = (calls: Call[]) => calls.filter((c) => c.name === 'translate');

describe('frame layout', () => {
  it('shares the height between the panels, and adds a slim bar strip only when the tab strip is not shown', () => {
    const two = frameLayout(H, 2, false);
    expect(two.bar).toBeNull();
    expect(two.panels[0].top).toBe(0);
    expect(two.panels[1].top + two.panels[1].height).toBe(H);

    const withBar = frameLayout(H, 2, true);
    expect(withBar.bar).not.toBeNull();
    expect(withBar.bar!.top + withBar.bar!.height).toBe(H);
    expect(withBar.panels[1].top + withBar.panels[1].height).toBeLessThan(withBar.bar!.top);
  });

  it('gives a single panel the whole frame above its bar strip', () => {
    const one = frameLayout(H, 1, false);
    expect(one.panels).toEqual([{ top: 0, height: H }]);
  });
});

describe('frame panels', () => {
  it('draws any two panels, in the order chosen', () => {
    // highway + tab: one region below the first, no bar strip
    expect(translates(frame(2.2, ['highway', 'tab']))).toHaveLength(1);
    // highway + real guitar: the real guitar region, then the bar strip
    expect(translates(frame(2.2, ['highway', 'neck']))).toHaveLength(2);
    // tab + real guitar: no bar strip
    expect(translates(frame(2.2, ['tab', 'neck']))).toHaveLength(1);
    // real guitar alone: just the bar strip below it
    expect(translates(frame(2.2, ['neck']))).toHaveLength(1);
  });

  it('draws the photo into the real guitar panel when it is given', () => {
    const image = { width: 10, height: 10 };
    expect(frame(2.2, ['highway', 'neck'], { lookahead: 4 }, W, H, image).some((c) => c.name === 'drawImage')).toBe(true);
    expect(frame(2.2, ['highway', 'tab'], { lookahead: 4 }, W, H, image).some((c) => c.name === 'drawImage')).toBe(false);
  });

  it('draws the fretboard when it is chosen, and not when it is not', () => {
    expect(dashed(frame(2.2, ['highway', 'fretboard'])).length).toBeGreaterThan(0);
    expect(dashed(frame(2.2, ['highway', 'tab']))).toHaveLength(0);
  });

  it('puts the same fretboard dots in the frame as the live fretboard draws', () => {
    const t = 2.2;
    const region = frameLayout(H, 2, true).panels[1];

    const live = createRecordingContext();
    renderFretboard(live.ctx, timeline, 0, t, W, region.height, { lookahead: 4 });
    const liveArcs = live.calls.filter((c) => c.name === 'arc');
    expect(liveArcs.length).toBeGreaterThan(0);

    const neck = computeNeck(W, region.height, 6, maxFretUsed(timeline.notesForTrack(0)));
    const frameArcs = frame(t, ['highway', 'fretboard']).filter((c) => c.name === 'arc' && (c.args[2] as number) <= neck.dotRadius * 4);
    for (const arc of liveArcs) expect(frameArcs).toContainEqual(arc);
  });

  it('uses the look-ahead it is given: 1 and 6 draw different numbers of upcoming markers', () => {
    const outlined = (la: number) => {
      const neck = computeNeck(W, frameLayout(H, 2, true).panels[1].height, 6, 8);
      return frame(2.2, ['highway', 'fretboard'], { lookahead: la }).filter(
        (c) => c.name === 'arc' && Math.abs((c.args[2] as number) - neck.dotRadius * 0.7) < 1e-9,
      ).length;
    };
    expect(outlined(1)).toBe(1);
    expect(outlined(6)).toBeGreaterThan(outlined(1));
  });

  it('lays out a vertical frame with the second panel in the lower part', () => {
    const regions = translates(frame(2.2, ['highway', 'fretboard'], { lookahead: 4 }, 1080, 1920));
    expect(regions).toHaveLength(2);
    expect(regions[0].args[1] as number).toBeGreaterThan(1920 * 0.4);
    expect(regions[1].args[1] as number).toBeGreaterThan(regions[0].args[1] as number);
  });

  it('draws the same frame for the same time, wherever it is rendered', () => {
    expect(frame(2.2, ['tab', 'neck'])).toEqual(frame(2.2, ['tab', 'neck']));
  });
});

describe('export start message', () => {
  it('sends the chosen panels and the look-ahead to the worker', () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(message: unknown) {
        posted.push(message);
      }
      terminate() {}
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    try {
      void startExport({
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'fretboard'],
        view: { lookahead: 6 },
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.type).toBe('start');
    expect(start.panels).toEqual(['highway', 'fretboard']);
    expect(start.view).toEqual({ lookahead: 6 });
    expect(start.preset.id).toBe('landscape');
  });

  it('sends the alignment and the lengthened output to the worker, and stretches the audio to match', () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(message: unknown) {
        posted.push(message);
      }
      terminate() {}
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    try {
      void startExport({
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'tab'],
        view: { lookahead: 6 },
        alignment: AlignmentMap.of(1, [{ at: 4, length: 3 }]),
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.alignment).toEqual({ base: 1, holds: [{ at: 4, length: 3 }] });
    expect(start.outputSeconds).toBeCloseTo(timeline.durationSeconds + 3, 9);
    expect(start.audio.left).toHaveLength(Math.ceil((timeline.durationSeconds + 3) * 48000));
  });

  it('sends the anchors with their bars, and the span of the recording as the output length', () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(message: unknown) {
        posted.push(message);
      }
      terminate() {}
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    const spans = timeline.bars.map((b) => ({ start: b.startSeconds, end: b.endSeconds }));
    const anchors = spans.map((b, k) => b.start + 1 + k * 0.1);
    const map = AlignmentMap.fromAnchors(spans, anchors, timeline.durationSeconds + 1 + spans.length * 0.1)!;
    try {
      void startExport({
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'tab'],
        view: { lookahead: 6 },
        alignment: map,
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.alignment?.anchors).toHaveLength(spans.length);
    expect(start.alignment?.bars).toHaveLength(spans.length);
    expect(start.outputSeconds).toBeCloseTo(map.outputLength(timeline.durationSeconds), 9);
    const rebuilt = AlignmentMap.normalize(start.alignment);
    expect(rebuilt?.hasAnchors).toBe(true);
    expect(rebuilt?.toRec(timeline.bars[2].startSeconds, 'start')).toBeCloseTo(anchors[2], 9);
  });

  it('sends no alignment and the tab length when there is none', () => {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(message: unknown) {
        posted.push(message);
      }
      terminate() {}
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    try {
      void startExport({
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'tab'],
        view: { lookahead: 6 },
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.alignment).toBeUndefined();
    expect(start.outputSeconds).toBe(timeline.durationSeconds);
  });

  it('covers AE6: carries the choice of technique cues to the worker with the other view options', () => {
    for (const neckCues of [true, false]) {
      const posted: unknown[] = [];
      class FakeWorker {
        onmessage: unknown = null;
        onerror: unknown = null;
        postMessage(message: unknown) {
          posted.push(message);
        }
        terminate() {}
      }
      const original = (globalThis as { Worker?: unknown }).Worker;
      (globalThis as { Worker?: unknown }).Worker = FakeWorker;
      try {
        void startExport({
          timeline,
          trackIndex: 0,
          preset: presetById('landscape'),
          audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
          panels: ['highway', 'neck'],
          view: { lookahead: 6, neckCues },
          onProgress: () => {},
        }).result.catch(() => {});
      } finally {
        (globalThis as { Worker?: unknown }).Worker = original;
      }
      expect((posted[0] as StartMessage).view.neckCues).toBe(neckCues);
    }
  });
});
