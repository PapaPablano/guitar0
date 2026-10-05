import { describe, expect, it } from 'vitest';
import { gemBox, HIT_EFFECT_SECONDS, renderHighway, visibleNotes } from '../../src/render/highway';
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

const FRET = 12;

/** The fret-number labels drawn on gems; bar numbers and string names never read '12'. */
function gemLabels(calls: ReturnType<typeof draw>) {
  return calls.filter((c) => c.name === 'fillText' && c.args[0] === String(FRET));
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
    const timeline = makeTimeline([{ start: 2, end: 2.5, string: 3, fret: FRET }]);
    const labels = gemLabels(draw(timeline, 2));
    expect(labels).toHaveLength(1);
    const box = gemBox(layout, timeline.notesForTrack(0)[0], 2);
    expect(box.x + box.w / 2).toBe(layout.strikeX);
    expect(labels[0].args[1]).toBe(layout.strikeX);
    expect(labels[0].args[2]).toBe(laneY(layout, 3));
  });

  it('places an upcoming note one second of travel to the right of the strikeline', () => {
    const layout = computeLayout(W, H, 6);
    const timeline = makeTimeline([{ start: 3, end: 3.5, fret: FRET }]);
    const labels = gemLabels(draw(timeline, 2));
    expect(labels[0].args[1]).toBeCloseTo(layout.strikeX + layout.pxPerSecond, 6);
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
    const timeline = makeTimeline([{ start: 2, end: 4, fret: FRET }]);
    const labels = gemLabels(draw(timeline, 3));
    expect(labels[0].args[1]).toBe(layout.strikeX);
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
    expect(gemLabels(calls)).toHaveLength(0);
    expect(calls.filter((c) => c.name === 'lineTo').length).toBeGreaterThanOrEqual(6);
  });

  it('draws bar lines with one-based bar numbers', () => {
    const timeline = makeTimeline([]);
    const labels = draw(timeline, 0).filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(labels).toContain('1');
    expect(labels).toContain('2');
  });
});

describe('neck styling', () => {
  it('names each open string at the nut', () => {
    const labels = draw(makeTimeline([]), 0)
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    for (const name of ['E', 'B', 'G', 'D', 'A']) expect(labels).toContain(name);
  });

  it('draws a faint line on each beat inside a bar', () => {
    const faint = draw(makeTimeline([], 2, 1), 0).filter((c) => c.name === 'set:globalAlpha' && c.args[0] === 0.08);
    expect(faint).toHaveLength(1);
  });

  it('lights the ring of a string only while its note sounds', () => {
    const ring = (t: number) =>
      draw(makeTimeline([{ start: 2, end: 3, string: 3 }]), t).filter(
        (c) => c.name === 'set:lineWidth' && c.args[0] === 3,
      ).length;
    // A lit ring is stroked 3 wide, an idle one 2 wide; the strikeline core is 3 wide either way.
    expect(ring(2.5)).toBeGreaterThan(ring(1));
  });

  it('keeps decorative inlay dots smaller than a note', () => {
    const layout = computeLayout(W, H, 6);
    const arcs = draw(makeTimeline([]), 0).filter((c) => c.name === 'arc');
    expect(arcs.length).toBeGreaterThan(0);
    for (const a of arcs) expect(a.args[2] as number).toBeLessThan(layout.noteRadius);
  });
});

describe('gem emphasis', () => {
  const layout = computeLayout(W, H, 6);
  const timeline = makeTimeline([{ start: 2, end: 3, string: 3, fret: FRET }]);
  const note = timeline.notesForTrack(0)[0];

  it('grows the gem as its start nears and again when it is struck', () => {
    const far = gemBox(layout, note, 1).w;
    const near = gemBox(layout, note, 1.8).w;
    const struck = gemBox(layout, note, 2).w;
    expect(near).toBeGreaterThan(far);
    expect(struck).toBeGreaterThan(near);
  });

  it('settles smaller than the strike but stays above normal while held, then returns', () => {
    const base = gemBox(layout, note, 1).w;
    const held = gemBox(layout, note, 2.8).w;
    expect(held).toBeGreaterThan(base);
    expect(held).toBeLessThan(gemBox(layout, note, 2).w);
    expect(gemBox(layout, note, 3.1).w).toBeCloseTo(base, 9);
  });

  it('keeps the gem centred on its string and, while it sounds, on the strikeline', () => {
    const box = gemBox(layout, note, 2.1);
    expect(box.x + box.w / 2).toBeCloseTo(layout.strikeX, 9);
    expect(box.y + box.h / 2).toBeCloseTo(laneY(layout, 3), 9);
  });

  it('draws the fret number larger while the note sounds', () => {
    const size = (t: number) => {
      const calls = draw(timeline, t);
      const at = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === String(FRET));
      const font = calls.slice(0, at).filter((c) => c.name === 'set:font').pop();
      return parseInt(String(font?.args[0]).replace('bold ', ''), 10);
    };
    expect(size(2.05)).toBeGreaterThan(size(1));
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
    const timeline = makeTimeline([{ start: 2, end: 2.5, string: 3, fret: FRET }]);
    const calls = draw(timeline, 2);
    const strikeAt = calls.findIndex(
      (c) => c.name === 'moveTo' && c.args[0] === layout.strikeX && c.args[1] === layout.laneTop,
    );
    const noteAt = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === String(FRET));
    expect(strikeAt).toBeGreaterThanOrEqual(0);
    expect(noteAt).toBeGreaterThan(strikeAt);
  });
});
