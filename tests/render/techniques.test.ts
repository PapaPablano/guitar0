import { describe, expect, it } from 'vitest';
import { renderHighway } from '../../src/render/highway';
import { bendLabel, fretLabel, techniqueMark } from '../../src/render/techniques';
import { computeLayout, laneY, timeToX } from '../../src/render/layout';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1200;
const H = 400;

function draw(spec: NoteSpec[], t = 2): Call[] {
  const timeline = makeTimeline(spec);
  const { ctx, calls } = createRecordingContext();
  renderHighway(ctx, timeline, 0, t, W, H);
  return calls;
}

const PLAIN_NOTE: NoteSpec = { start: 2, end: 2.3, string: 3, fret: 5 };

function withTechnique(techniques: NoteSpec['techniques'], extra: NoteSpec[] = []): NoteSpec[] {
  return [{ ...PLAIN_NOTE, techniques }, ...extra];
}

/** Calls other than those the plain note also makes. */
function extraCalls(spec: NoteSpec[]): Call[] {
  const base = draw([PLAIN_NOTE]);
  const withMark = draw(spec);
  return withMark.filter((c) => !base.some((b) => b.name === c.name && JSON.stringify(b.args) === JSON.stringify(c.args)));
}

describe('technique marks', () => {
  it('draws something extra for every technique and nothing for a plain note', () => {
    expect(extraCalls([PLAIN_NOTE])).toHaveLength(0);
    for (const tech of [
      { bend: 2 },
      { slide: 'out-down' as const },
      { slide: 'in-below' as const },
      { palmMute: true },
      { harmonic: true },
      { vibrato: true },
    ]) {
      expect(extraCalls(withTechnique(tech, tech.vibrato ? [] : [])).length, JSON.stringify(tech)).toBeGreaterThan(0);
    }
  });

  it('shows the bend size above a bent note', () => {
    const labels = draw(withTechnique({ bend: 2 }))
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    expect(labels).toContain('full');
    const half = draw(withTechnique({ bend: 1 }))
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    expect(half).toContain('½');
  });

  it('labels palm muting', () => {
    const labels = draw(withTechnique({ palmMute: true }))
      .filter((c) => c.name === 'fillText')
      .map((c) => c.args[0]);
    expect(labels).toContain('PM');
  });

  it('draws a diamond around a harmonic', () => {
    const closes = (calls: Call[]) => calls.filter((c) => c.name === 'closePath').length;
    // The gem and the nut close paths too, so count only what the harmonic adds.
    expect(closes(draw(withTechnique({ harmonic: true }))) - closes(draw([PLAIN_NOTE]))).toBe(1);
  });

  it('shows an x for a dead note and parentheses for a ghost note', () => {
    const dead = draw(withTechnique({ dead: true })).filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(dead).toContain('x');
    const ghost = draw(withTechnique({ ghost: true })).filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(ghost).toContain('(5)');
  });

  it('connects a slide to the next note on the same string, even across a bar line', () => {
    const layout = computeLayout(W, H, 6);
    // bars are 2 s long in the helper, so these two notes sit in different bars
    const spec: NoteSpec[] = [
      { start: 1.9, end: 2.0, string: 3, fret: 5, techniques: { slide: 'legato' } },
      { start: 2.1, end: 2.4, string: 3, fret: 9 },
    ];
    const calls = draw(spec, 1.9);
    const y = laneY(layout, 3);
    const lines = calls.filter((c) => c.name === 'lineTo');
    const reachesSecondNote = lines.some((c) => Math.abs((c.args[0] as number) - (timeToX(layout, 2.1, 1.9) - layout.noteRadius)) < 1);
    expect(reachesSecondNote).toBe(true);
    // rising slide ends above the lane centre line
    const end = lines.find((c) => Math.abs((c.args[0] as number) - (timeToX(layout, 2.1, 1.9) - layout.noteRadius)) < 1);
    expect(end?.args[1] as number).toBeLessThan(y);
  });

  it('marks a hammer-on and a pull-off differently', () => {
    const up: NoteSpec[] = [
      { start: 2, end: 2.2, string: 2, fret: 5, techniques: { hammerPull: 'origin' } },
      { start: 2.3, end: 2.6, string: 2, fret: 7, techniques: { hammerPull: 'destination' } },
    ];
    const down: NoteSpec[] = [
      { start: 2, end: 2.2, string: 2, fret: 7, techniques: { hammerPull: 'origin' } },
      { start: 2.3, end: 2.6, string: 2, fret: 5, techniques: { hammerPull: 'destination' } },
    ];
    const labels = (spec: NoteSpec[]) =>
      draw(spec)
        .filter((c) => c.name === 'fillText')
        .map((c) => c.args[0]);
    expect(labels(up)).toContain('H');
    expect(labels(down)).toContain('P');
  });

  it('falls back to a plain note for a technique it does not know', () => {
    const unknown = { somethingNew: true } as unknown as NoteSpec['techniques'];
    expect(draw(withTechnique(unknown))).toEqual(draw([PLAIN_NOTE]));
  });
});

describe('labels', () => {
  it('names common bend sizes', () => {
    expect([bendLabel(0.5), bendLabel(1), bendLabel(2), bendLabel(3), bendLabel(4)]).toEqual(['¼', '½', 'full', '1½', '2']);
  });

  it('builds the fret label and the strip mark', () => {
    const timeline = makeTimeline([
      { start: 0, end: 1, fret: 7, techniques: { bend: 2, palmMute: true } },
      { start: 1, end: 2, fret: 3 },
    ]);
    const [bent, plain] = timeline.notesForTrack(0);
    expect(fretLabel(bent)).toBe('7');
    expect(techniqueMark(bent)).toBe('bfull PM');
    expect(techniqueMark(plain)).toBe('');
  });
});
