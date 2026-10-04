import { describe, expect, it } from 'vitest';
import type { StartMessage } from '../../src/export/encoder.worker';
import { presetById } from '../../src/export/presets';
import { serializeTimeline } from '../../src/model/serialize';
import { HIGHWAY_SHARE, renderComposite, type BottomOptions, type CompositeContext } from '../../src/render/composite';
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
    const highwayHeight = Math.round(H * HIGHWAY_SHARE);
    const gap = Math.round(H * 0.01);
    const bottomHeight = H - (highwayHeight + gap);
    const timelineHeight = Math.max(28, Math.round(H * 0.035));
    const fretboardHeight = bottomHeight - timelineHeight - gap;

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
      const neck = computeNeck(W, H - Math.round(H * HIGHWAY_SHARE) - Math.round(H * 0.01) - 38 - Math.round(H * 0.01), 6, 8);
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
  it('carries the bottom view and look-ahead to the worker', () => {
    const message: StartMessage = {
      type: 'start',
      data: serializeTimeline(timeline, 0),
      trackIndex: 0,
      preset: presetById('landscape'),
      audio: { left: new Float32Array(1), right: new Float32Array(1), sampleRate: 48000 },
      bottom: { view: 'fretboard', lookahead: 6 },
    };
    expect(structuredClone({ bottom: message.bottom })).toEqual({ bottom: { view: 'fretboard', lookahead: 6 } });
  });
});
