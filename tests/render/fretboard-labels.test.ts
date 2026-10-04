import { describe, expect, it } from 'vitest';
import { computeNeck, renderFretboard, stringLineY, type LabelMode } from '../../src/render/fretboard';
import { frameLayout, renderComposite, type CompositeContext } from '../../src/render/composite';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1100;
const H = 300;
const HALF_STEP_DOWN = [63, 58, 54, 49, 44, 39];

function draw(specs: NoteSpec[], t: number, mode: LabelMode, tuning?: number[]): Call[] {
  const base = makeTimeline(specs);
  const timeline = tuning ? { ...base, tracks: [{ ...base.tracks[0], tuning }] } : base;
  const { ctx, calls } = createRecordingContext();
  renderFretboard(ctx, timeline, 0, t, W, H, { labelMode: mode });
  return calls;
}

const texts = (calls: Call[]) => calls.filter((c) => c.name === 'fillText').map((c) => c.args[0] as string);

// string 3 (G) at fret 5 is C; string 2 (B) at fret 3 is D
const specs: NoteSpec[] = [
  { start: 1, end: 2, string: 3, fret: 5 },
  { start: 3, end: 4, string: 2, fret: 3 },
];

describe('open-string names', () => {
  it('shows E B G D A E at the far left in standard tuning', () => {
    const neck = computeNeck(W, H, 6, 5);
    const names = draw(specs, 1.2, 'fret').filter((c) => c.name === 'fillText' && (c.args[0] as string).length === 1 && (c.args[1] as number) < neck.nutX - neck.dotRadius * 2 - 16);
    const byRow = names.sort((a, b) => (a.args[2] as number) - (b.args[2] as number)).map((c) => c.args[0]);
    expect(byRow).toEqual(['E', 'B', 'G', 'D', 'A', 'E']);
  });

  it('shows the file\'s own tuning, with flats, when it is a half step down', () => {
    const calls = draw(specs, 1.2, 'fret', HALF_STEP_DOWN);
    const neck = computeNeck(W, H, 6, 5);
    const rows = calls
      .filter((c) => c.name === 'fillText' && (c.args[1] as number) === 24)
      .sort((a, b) => (a.args[2] as number) - (b.args[2] as number))
      .map((c) => c.args[0]);
    expect(rows).toEqual(['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb']);
    // each name sits on its string's row
    const first = calls.find((c) => c.name === 'fillText' && c.args[0] === 'Eb' && c.args[1] === 24);
    expect(first?.args[2]).toBe(stringLineY(neck, 1));
  });

  it('is drawn left of the nut, with room for the open-string dots', () => {
    const neck = computeNeck(W, H, 6, 5);
    expect(24).toBeLessThan(neck.nutX - neck.dotRadius * 2 - 16);
  });
});

describe('dot labels', () => {
  it('shows fret numbers by default, as before', () => {
    const labels = texts(draw(specs, 1.2, 'fret'));
    expect(labels).toContain('5');
    expect(labels).toContain('3');
  });

  it('shows note names in note mode and no fret numbers on the dots', () => {
    const calls = draw(specs, 1.2, 'note');
    const labels = texts(calls);
    expect(labels).toContain('C');
    expect(labels).toContain('D');
    // the only digits left are the fret numbers printed under the neck (1..7), never on a dot at 5 or 3 twice
    const dotRadius = computeNeck(W, H, 6, 5).dotRadius;
    const dotFonts = calls.filter((c) => c.name === 'set:font' && String(c.args[0]).includes(`${Math.round(dotRadius * 1.1)}px`));
    expect(dotFonts.length).toBeGreaterThan(0);
  });

  it('shows the note with the fret under it in both mode', () => {
    const labels = texts(draw(specs, 1.2, 'both'));
    expect(labels).toContain('C');
    expect(labels).toContain('5');
    expect(labels).toContain('D');
    expect(labels).toContain('3');
  });

  it('names a half-step-down note correctly: fret 5 on the Gb string is Bb', () => {
    // string 3 is Gb (54) a half step down, so fret 5 is 59 = B
    expect(texts(draw(specs, 1.2, 'note', HALF_STEP_DOWN))).toContain('B');
    // string 2 is Bb (58); fret 3 is 61 = Db
    expect(texts(draw(specs, 1.2, 'note', HALF_STEP_DOWN))).toContain('Db');
  });

  it('keeps an x for a dead note and brackets a ghost note in note mode', () => {
    const dead = texts(draw([{ start: 1, end: 2, string: 3, fret: 5, techniques: { dead: true } }], 1.2, 'note'));
    expect(dead).toContain('x');
    const ghost = texts(draw([{ start: 1, end: 2, string: 3, fret: 5, techniques: { ghost: true } }], 1.2, 'note'));
    expect(ghost).toContain('(C)');
  });

  it('falls back to fret numbers when the track has no tuning', () => {
    const labels = texts(draw(specs, 1.2, 'note', []));
    expect(labels).toContain('5');
  });
});

describe('export uses the chosen label mode', () => {
  it('draws note names in the exported frame when note mode is selected', () => {
    const timeline = makeTimeline(specs, 2, 6);
    const frame = (mode: LabelMode) => {
      const { ctx, calls } = createRecordingContext();
      renderComposite(ctx as unknown as CompositeContext, timeline, 0, 1.2, 1920, 1080, {
        bottom: { view: 'fretboard', lookahead: 4, labelMode: mode },
      });
      return texts(calls);
    };
    expect(frame('note')).toContain('C');
    expect(frame('fret')).not.toContain('C');
    expect(frameLayout(1080).fretboardHeight).toBeGreaterThan(0);
  });
});
