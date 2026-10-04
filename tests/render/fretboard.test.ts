import { describe, expect, it } from 'vitest';
import {
  computeNeck,
  fretLineX,
  MIN_DOT_RADIUS,
  MIN_FRETS,
  noteDotX,
  renderFretboard,
  stringLineY,
} from '../../src/render/fretboard';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1100;
const H = 300;

function draw(specs: NoteSpec[], t: number, lookahead?: number, strings = 6): Call[] {
  const timeline = makeTimeline(specs);
  const adjusted = { ...timeline, tracks: [{ ...timeline.tracks[0], stringCount: strings }] };
  const { ctx, calls } = createRecordingContext();
  renderFretboard(ctx, adjusted, 0, t, W, H, { lookahead });
  return calls;
}

const neckFor = (highest: number, strings = 6) => computeNeck(W, H, strings, highest);
const arcs = (calls: Call[], radius: number) =>
  calls.filter((c) => c.name === 'arc' && Math.abs((c.args[2] as number) - radius) < 1e-9);

/** lineTo calls made while a dashed line is active: the path segments. */
function pathSegments(calls: Call[]): Call[] {
  const out: Call[] = [];
  let dashed = false;
  for (const c of calls) {
    if (c.name === 'setLineDash') dashed = (c.args[0] as number[]).length > 0;
    else if (dashed && c.name === 'lineTo') out.push(c);
  }
  return out;
}

describe('neck geometry', () => {
  it('shows at least 7 frets and up to the highest fret used', () => {
    expect(neckFor(3).fretCount).toBe(MIN_FRETS);
    expect(neckFor(17).fretCount).toBe(17);
    expect(neckFor(40).fretCount).toBe(24);
  });

  it('spaces frets by the real ratio, so they get narrower up the neck', () => {
    const neck = neckFor(12);
    const first = fretLineX(neck, 1) - fretLineX(neck, 0);
    const last = fretLineX(neck, 12) - fretLineX(neck, 11);
    expect(last).toBeLessThan(first);
    expect(fretLineX(neck, 12)).toBeCloseTo(neck.boardRight, 6);
  });

  it('keeps dots at least the minimum radius, even on a 24-fret neck', () => {
    expect(neckFor(24).dotRadius).toBeGreaterThanOrEqual(MIN_DOT_RADIUS);
  });

  it('puts string 1 on top and an open string left of the nut', () => {
    const neck = neckFor(12);
    expect(stringLineY(neck, 1)).toBeLessThan(stringLineY(neck, 6));
    expect(noteDotX(neck, 0)).toBeLessThan(neck.nutX);
    expect(noteDotX(neck, 5)).toBeGreaterThan(fretLineX(neck, 4));
    expect(noteDotX(neck, 5)).toBeLessThan(fretLineX(neck, 5));
  });
});

describe('frets beyond the neck', () => {
  it('puts a note above the last drawn fret on the last fret, still on the board', () => {
    const neck = neckFor(27);
    expect(neck.fretCount).toBe(24);
    expect(noteDotX(neck, 27)).toBe(noteDotX(neck, 24));
    expect(noteDotX(neck, 27)).toBeLessThanOrEqual(neck.boardRight);
  });

  it('still labels the dot with the real fret number', () => {
    const calls = draw([{ start: 1, end: 2, string: 2, fret: 27 }], 1.2);
    expect(calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toContain('27');
  });
});

describe('renderFretboard', () => {
  it('draws the playing note at its string and fret', () => {
    const neck = neckFor(7);
    const calls = draw([{ start: 1, end: 2, string: 3, fret: 5 }, { start: 3, end: 4, string: 2, fret: 7 }], 1.2);
    const [dot] = arcs(calls, neck.dotRadius);
    expect(dot.args[0]).toBeCloseTo(noteDotX(neck, 5), 6);
    expect(dot.args[1]).toBeCloseTo(stringLineY(neck, 3), 6);
  });

  it('draws one solid dot per note of a chord', () => {
    const neck = neckFor(5);
    const calls = draw(
      [
        { start: 1, end: 2, string: 1, fret: 3 },
        { start: 1, end: 2, string: 2, fret: 2 },
        { start: 1, end: 2, string: 3, fret: 5 },
        { start: 3, end: 4, string: 1, fret: 0 },
      ],
      1.2,
    );
    expect(arcs(calls, neck.dotRadius)).toHaveLength(3);
  });

  it('draws an open-string note beside the nut', () => {
    const neck = neckFor(7);
    const calls = draw([{ start: 1, end: 2, string: 2, fret: 0 }, { start: 3, end: 4, fret: 7 }], 1.2);
    const [dot] = arcs(calls, neck.dotRadius);
    expect(dot.args[0] as number).toBeLessThan(neck.nutX);
  });

  it('draws an x for a dead note', () => {
    const calls = draw([{ start: 1, end: 2, string: 2, fret: 3, techniques: { dead: true } }], 1.2);
    expect(calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toContain('x');
  });

  it('draws one string line per string, so a bass track shows four', () => {
    const neck = neckFor(7, 4);
    const calls = draw([{ start: 1, end: 2, string: 4, fret: 3 }], 1.2, 4, 4);
    const stringStartX = neck.nutX - neck.dotRadius * 2 - 16;
    expect(calls.filter((c) => c.name === 'moveTo' && c.args[0] === stringStartX)).toHaveLength(4);
  });

  it('joins the playing note to each upcoming note with one dashed segment', () => {
    const calls = draw(
      [
        { start: 1, end: 1.5, string: 1, fret: 2 },
        { start: 2, end: 2.5, string: 2, fret: 4 },
        { start: 3, end: 3.5, string: 3, fret: 6 },
        { start: 4, end: 4.5, string: 4, fret: 7 },
      ],
      1.2,
      2,
    );
    expect(pathSegments(calls)).toHaveLength(2);
  });

  it('adds no segment for a step at the same position, and rings the playing dot instead', () => {
    const neck = neckFor(7);
    const calls = draw(
      [
        { start: 1, end: 1.5, string: 2, fret: 5 },
        { start: 2, end: 2.5, string: 2, fret: 5 },
        { start: 3, end: 3.5, string: 3, fret: 7 },
      ],
      1.2,
      1,
    );
    expect(pathSegments(calls)).toHaveLength(0);
    expect(arcs(calls, neck.dotRadius * 1.35)).toHaveLength(1);
  });

  it('draws only one upcoming marker with a look-ahead of 1', () => {
    const neck = neckFor(9);
    const specs: NoteSpec[] = [1, 2, 3, 4, 5].map((s, i) => ({ start: s, end: s + 0.5, string: 1 + (i % 5), fret: 3 + i }));
    expect(arcs(draw(specs, 1.2, 1), neck.dotRadius * 0.7)).toHaveLength(1);
    expect(arcs(draw(specs, 1.2, 4), neck.dotRadius * 0.7)).toHaveLength(4);
  });

  it('labels dots with their fret numbers', () => {
    const calls = draw([{ start: 1, end: 2, string: 2, fret: 5 }, { start: 2, end: 3, string: 3, fret: 7 }], 1.2);
    const labels = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(labels).toContain('5');
    expect(labels).toContain('7');
  });

  it('draws the bare neck and no note markers for a track with no notes', () => {
    const neck = neckFor(0);
    const calls = draw([], 1);
    expect(arcs(calls, neck.dotRadius)).toHaveLength(0);
    expect(arcs(calls, neck.dotRadius * 0.7)).toHaveLength(0);
    expect(arcs(calls, neck.dotRadius * 0.8)).toHaveLength(0);
    expect(calls.filter((c) => c.name === 'lineTo').length).toBeGreaterThan(10);
  });

  it('draws the playing dot after a trail dot on the same string and fret', () => {
    const neck = neckFor(7);
    const calls = draw(
      [
        { start: 1, end: 1.5, string: 2, fret: 5 },
        { start: 2, end: 2.5, string: 2, fret: 5 },
      ],
      2.2,
    );
    const trailAt = calls.findIndex((c) => c.name === 'arc' && c.args[2] === neck.dotRadius * 0.8);
    const playingAt = calls.findIndex((c) => c.name === 'arc' && c.args[2] === neck.dotRadius);
    expect(trailAt).toBeGreaterThanOrEqual(0);
    expect(playingAt).toBeGreaterThan(trailAt);
  });

  it('draws only as many fret numbers as the neck has', () => {
    const labels = draw([{ start: 1, end: 2, fret: 3 }], 1.2)
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    expect(labels).toContain('7');
    expect(labels).not.toContain('8');
  });

  it('draws the same calls twice for the same time', () => {
    const specs: NoteSpec[] = [
      { start: 1, end: 1.5, string: 2, fret: 5 },
      { start: 2, end: 2.5, string: 3, fret: 7 },
    ];
    expect(draw(specs, 1.2)).toEqual(draw(specs, 1.2));
  });
});
