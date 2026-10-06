import { describe, expect, it } from 'vitest';
import type { StartMessage } from '../../src/export/encoder.worker';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { startExport } from '../../src/export/exporter';
import { presetById } from '../../src/export/presets';
import { frameLayout, renderComposite, type BottomOptions, type CompositeContext } from '../../src/render/composite';
import { computeNeck, renderFretboard } from '../../src/render/fretboard';
import { maxFretUsed } from '../../src/render/fretboard-steps';
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

function composite(t: number, bottom?: BottomOptions, w = W, h = H): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderComposite(ctx as unknown as CompositeContext, timeline, 0, t, w, h, bottom ? { bottom } : {});
  return calls;
}

const dashed = (calls: Call[]) => calls.filter((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0);
const translates = (calls: Call[]) => calls.filter((c) => c.name === 'translate');

describe('composite bottom view', () => {
  it('draws the fretboard under the highway when the fretboard view is selected', () => {
    const calls = composite(2.2, { view: 'fretboard', lookahead: 4 });
    // the fretboard draws a dashed path; the tab strip never does
    expect(dashed(calls).length).toBeGreaterThan(0);
    // the fretboard and the slim timeline each move the origin below the highway
    expect(translates(calls)).toHaveLength(2);
  });

  it('draws the tab strip, as before, when the tab view is selected or nothing is chosen', () => {
    const none = composite(2.2);
    const tab = composite(2.2, { view: 'tab', lookahead: 4 });
    expect(tab).toEqual(none);
    expect(dashed(none)).toHaveLength(0);
    expect(translates(none)).toHaveLength(1);
  });

  it('puts the same fretboard dots in the frame as the live fretboard draws', () => {
    const t = 2.2;
    const { fretboardHeight } = frameLayout(H);

    const live = createRecordingContext();
    renderFretboard(live.ctx, timeline, 0, t, W, fretboardHeight, { lookahead: 4 });
    const liveArcs = live.calls.filter((c) => c.name === 'arc');
    expect(liveArcs.length).toBeGreaterThan(0);

    const neck = computeNeck(W, fretboardHeight, 6, maxFretUsed(timeline.notesForTrack(0)));
    const frameArcs = composite(t, { view: 'fretboard', lookahead: 4 }).filter(
      (c) => c.name === 'arc' && (c.args[2] as number) <= neck.dotRadius * 4 && c.args[1] !== undefined,
    );
    // every fretboard arc appears in the frame (the highway adds its own note heads too)
    for (const arc of liveArcs) expect(frameArcs).toContainEqual(arc);
  });

  it('uses the look-ahead it is given: 1 and 6 draw different numbers of upcoming markers', () => {
    const outlined = (la: number) => {
      const neck = computeNeck(W, frameLayout(H).fretboardHeight, 6, 8);
      return composite(2.2, { view: 'fretboard', lookahead: la }).filter(
        (c) => c.name === 'arc' && Math.abs((c.args[2] as number) - neck.dotRadius * 0.7) < 1e-9,
      ).length;
    };
    expect(outlined(1)).toBe(1);
    expect(outlined(6)).toBeGreaterThan(outlined(1));
  });

  it('lays out a vertical frame with the fretboard in the lower part', () => {
    const calls = composite(2.2, { view: 'fretboard', lookahead: 4 }, 1080, 1920);
    const regions = translates(calls);
    expect(regions).toHaveLength(2);
    expect(regions[0].args[1] as number).toBeGreaterThan(1920 * 0.5);
    expect(regions[1].args[1] as number).toBeGreaterThan(regions[0].args[1] as number);
  });
});

describe('export start message', () => {
  it('sends the bottom view and look-ahead to the worker', () => {
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
        bottom: { view: 'fretboard', lookahead: 6 },
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.type).toBe('start');
    expect(start.bottom).toEqual({ view: 'fretboard', lookahead: 6 });
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
        bottom: { view: 'tab', lookahead: 6 },
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
        bottom: { view: 'tab', lookahead: 6 },
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
        bottom: { view: 'tab', lookahead: 6 },
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.alignment).toBeUndefined();
    expect(start.outputSeconds).toBe(timeline.durationSeconds);
  });
});
