import { describe, expect, it } from 'vitest';
import { HIT_EFFECT_SECONDS, renderHighway, visibleNotes } from '../../src/render/highway';
import { computeLayout, laneY, timeToX } from '../../src/render/layout';
import { createRecordingContext } from '../helpers/recording-context';
import { makeTimeline } from '../helpers/make-timeline';

const W = 1200;
const H = 400;

function draw(timeline: ReturnType<typeof makeTimeline>, t: number) {
  const { ctx, calls } = createRecordingContext();
  renderHighway(ctx, timeline, 0, t, W, H);
  return calls;
}

/** Arc calls that draw a filled note head (radius equals the note radius). */
function noteHeads(calls: ReturnType<typeof draw>) {
  const layout = computeLayout(W, H, 6);
  return calls.filter((c) => c.name === 'arc' && c.args[2] === layout.noteRadius);
}

describe('layout', () => {
  it('puts string 1 in the top lane and the last string in the bottom lane', () => {
    const layout = computeLayout(W, H, 6);
    expect(laneY(layout, 1)).toBeLessThan(laneY(layout, 6));
    expect(laneY(layout, 2) - laneY(layout, 1)).toBeCloseTo(layout.laneHeight, 9);
  });

  it('maps the playhead time to the strikeline', () => {
    const layout = computeLayout(W, H, 6);
    expect(timeToX(layout, 5, 5)).toBe(layout.strikeX);
    expect(timeToX(layout, 6, 5)).toBeCloseTo(layout.strikeX + layout.pxPerSecond, 9);
  });
});

describe('renderHighway', () => {
  it('renders the same drawing calls twice for the same time', () => {
    const timeline = makeTimeline([
      { start: 1, end: 1.5, string: 2 },
      { start: 2, end: 3.5, string: 4, fret: 7 },
    ]);
    expect(draw(timeline, 1.2)).toEqual(draw(timeline, 1.2));
  });

  it('places a note on the strikeline at its start time', () => {
    const layout = computeLayout(W, H, 6);
    const timeline = makeTimeline([{ start: 2, end: 2.5, string: 3 }]);
    const heads = noteHeads(draw(timeline, 2));
    expect(heads).toHaveLength(1);
    expect(heads[0].args[0]).toBe(layout.strikeX);
    expect(heads[0].args[1]).toBe(laneY(layout, 3));
  });

  it('places an upcoming note one second of travel to the right of the strikeline', () => {
    const layout = computeLayout(W, H, 6);
    const timeline = makeTimeline([{ start: 3, end: 3.5 }]);
    const heads = noteHeads(draw(timeline, 2));
    expect(heads[0].args[0]).toBeCloseTo(layout.strikeX + layout.pxPerSecond, 6);
  });

  it('draws a sustain tail whose length matches the note duration', () => {
    const layout = computeLayout(W, H, 6);
    const timeline = makeTimeline([{ start: 3, end: 4.5 }]);
    const tails = draw(timeline, 2).filter((c) => c.name === 'fillRect' && c.args[2] !== W);
    expect(tails).toHaveLength(1);
    expect(tails[0].args[2] as number).toBeCloseTo(1.5 * layout.pxPerSecond, 6);
  });

  it('draws no tail for a note shorter than its head', () => {
    const timeline = makeTimeline([{ start: 3, end: 3.05 }]);
    const tails = draw(timeline, 2).filter((c) => c.name === 'fillRect' && c.args[2] !== W);
    expect(tails).toHaveLength(0);
  });

  it('holds a sustained note at the strikeline while it sounds', () => {
    const layout = computeLayout(W, H, 6);
    const timeline = makeTimeline([{ start: 2, end: 4 }]);
    const heads = noteHeads(draw(timeline, 3));
    expect(heads[0].args[0]).toBe(layout.strikeX);
  });

  it('draws a hit ring only shortly after the note starts', () => {
    const layout = computeLayout(W, H, 6);
    const timeline = makeTimeline([{ start: 2, end: 2.5 }]);
    const ring = (t: number) =>
      draw(timeline, t).filter((c) => c.name === 'arc' && (c.args[2] as number) > layout.noteRadius);
    expect(ring(2.1)).toHaveLength(1);
    expect(ring(2 + HIT_EFFECT_SECONDS + 0.01)).toHaveLength(0);
    expect(ring(1.9)).toHaveLength(0);
  });

  it('draws strings but no note heads for a window with no notes', () => {
    const timeline = makeTimeline([{ start: 10, end: 10.5 }], 2, 8);
    const calls = draw(timeline, 0);
    expect(noteHeads(calls)).toHaveLength(0);
    expect(calls.filter((c) => c.name === 'lineTo').length).toBeGreaterThanOrEqual(6);
  });

  it('draws bar lines with one-based bar numbers', () => {
    const timeline = makeTimeline([]);
    const labels = draw(timeline, 0).filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(labels).toContain('1');
    expect(labels).toContain('2');
  });
});

describe('visibleNotes', () => {
  it('includes a long note that began before the window but is still sounding', () => {
    const timeline = makeTimeline([
      { start: 0, end: 30 },
      { start: 5, end: 5.5 },
      { start: 40, end: 41 },
    ]);
    const found = visibleNotes(timeline.notesForTrack(0), 10, 12);
    expect(found.map((n) => n.startSeconds)).toEqual([0]);
  });
});

describe('layering', () => {
  it('draws the strikeline before the notes so it never covers one', () => {
    const layout = computeLayout(W, H, 6);
    const timeline = makeTimeline([{ start: 2, end: 2.5, string: 3 }]);
    const calls = draw(timeline, 2);
    const strikeAt = calls.findIndex(
      (c) => c.name === 'moveTo' && c.args[0] === layout.strikeX && c.args[1] === layout.laneTop,
    );
    const noteAt = calls.findIndex((c) => c.name === 'arc' && c.args[2] === layout.noteRadius);
    expect(strikeAt).toBeGreaterThanOrEqual(0);
    expect(noteAt).toBeGreaterThan(strikeAt);
  });
});
