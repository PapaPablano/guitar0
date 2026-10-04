import { describe, expect, it } from 'vitest';
import type { StartMessage } from '../../src/export/encoder.worker';
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
      (c) => c.name === 'arc' && (c.args[2] as number) <= neck.dotRadius * 1.4 && c.args[1] !== undefined,
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
});
