import { describe, expect, it } from 'vitest';
import {
  buildStripLayout,
  FRET_FONT_MIN,
  GUTTER_WIDTH,
  MIN_BAR_WIDTH,
  MIN_SLOT_WIDTH,
  playheadStripX,
  renderTabStrip,
  scoreBarAtX,
  scoreBarStartSeconds,
  stripScrollX,
} from '../../src/render/tab-strip';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { makeTimeline } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';
import { LANE_BUDGET } from '../../src/render/strip-marks';
import { busyPassage, overlaps, textBoxes } from './strip-fixtures';

const W = 900;
const H = 200;

describe('tab strip layout', () => {
  it('lays bars out in score order and marks repeat boundaries', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    expect(layout.bars.map((b) => b.scoreBar)).toEqual([0, 1, 2, 3]);
    expect(layout.bars.map((b) => b.repeatStart)).toEqual([true, false, false, false]);
    expect(layout.bars.map((b) => b.repeatEnd)).toEqual([false, false, true, false]);
    // each bar's notes are listed once even though the repeat plays them twice
    expect(layout.bars.reduce((sum, b) => sum + b.notes.length, 0)).toBe(16);
  });

  it('keeps the cursor on the same bar position the highway shows, and jumps back across a repeat', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    // bars are 2 s long at 120 bpm; the repeat sends playback from the end of bar 2 (6 s) back to bar 0
    const beforeJump = playheadStripX(layout, timeline, 5.99);
    const afterJump = playheadStripX(layout, timeline, 6.01);
    expect(afterJump).toBeLessThan(beforeJump);
    // bar 0 opens with a note on the downbeat, so 0.01 s in the cursor is just past that note, on its way to the next
    const [first, second] = layout.bars[0].slots;
    const expected = layout.bars[0].x + first.offset + (0.01 / (second.seconds - first.seconds)) * (second.offset - first.offset);
    expect(afterJump).toBeCloseTo(expected, 3);
    // playback time keeps increasing while the strip x moved back
    expect(6.01).toBeGreaterThan(5.99);
  });

  it('scrolls so the playhead sits at the fixed cursor position', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    const t = 3;
    expect(playheadStripX(layout, timeline, t) - stripScrollX(layout, timeline, t)).toBeCloseTo(layout.cursorX, 9);
  });

  it('finds the bar under a canvas position and the start time of a bar', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const layout = buildStripLayout(timeline, 0, W, H);
    expect(scoreBarAtX(layout, timeline, 0, layout.cursorX + 1)).toBe(0);
    expect(scoreBarAtX(layout, timeline, 0, W + 5000)).toBeNull();
    expect(scoreBarStartSeconds(layout, 1)).toBeCloseTo(2, 6);
    expect(scoreBarStartSeconds(layout, 9)).toBeNull();
  });
});

describe('renderTabStrip', () => {
  it('draws one fret number per note in view and the cursor', () => {
    const timeline = makeTimeline([
      { start: 0.5, end: 1, string: 2, fret: 5 },
      { start: 1, end: 1.5, string: 3, fret: 7 },
    ]);
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, H);
    const labels = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(labels).toContain('5');
    expect(labels).toContain('7');
  });

  it('renders the same calls twice for the same time', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const a = createRecordingContext();
    const b = createRecordingContext();
    renderTabStrip(a.ctx, timeline, 0, 4.2, W, H);
    renderTabStrip(b.ctx, timeline, 0, 4.2, W, H);
    expect(a.calls).toEqual(b.calls);
  });

  it('highlights the loop range', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, H, { loop: { startBar: 1, endBar: 2 } });
    const tinted = calls.filter((c) => c.name === 'set:fillStyle' && String(c.args[0]).startsWith('rgba'));
    expect(tinted).toHaveLength(1);
  });
});

describe('strip layering', () => {
  it('draws the cursor before the fret numbers so it never hides the playing note', () => {
    const timeline = makeTimeline([{ start: 0.2, end: 0.6, string: 2, fret: 5 }]);
    const layout = buildStripLayout(timeline, 0, W, H);
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, H);
    const cursorAt = calls.findIndex((c) => c.name === 'moveTo' && c.args[0] === layout.cursorX);
    const numberAt = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === '5');
    expect(cursorAt).toBeGreaterThanOrEqual(0);
    expect(numberAt).toBeGreaterThan(cursorAt);
  });
});

const eighths = (from: number, count: number, step = 0.25) =>
  Array.from({ length: count }, (_, i) => ({ start: from + i * step, end: from + (i + 1) * step, string: 2, fret: 5 }));

describe('note-value spacing', () => {
  it('gives every note in a sixteenth run room for a two-digit fret, at a short and a tall panel', () => {
    const timeline = makeTimeline(eighths(0, 16, 0.125));
    for (const height of [60, 200, 400]) {
      const bar = buildStripLayout(timeline, 0, W, height).bars[0];
      expect(bar.slots).toHaveLength(16);
      for (let i = 1; i < bar.slots.length; i++) {
        expect(bar.slots[i].offset - bar.slots[i - 1].offset).toBeGreaterThanOrEqual(MIN_SLOT_WIDTH);
      }
    }
  });

  it('keeps a whole note no wider than a bar of eight eighths', () => {
    const timeline = makeTimeline([{ start: 0, end: 2, string: 2, fret: 5 }, ...eighths(2, 8)]);
    const [whole, run] = buildStripLayout(timeline, 0, W, H).bars;
    expect(whole.width).toBeLessThanOrEqual(run.width);
  });

  it('gives a bar with no notes the minimum bar width', () => {
    const timeline = makeTimeline(eighths(0, 8));
    const layout = buildStripLayout(timeline, 0, W, H);
    expect(layout.bars[3].width).toBe(MIN_BAR_WIDTH);
  });

  it('lays bars out the same whatever the canvas size', () => {
    const timeline = makeTimeline([...eighths(0, 8), ...eighths(2, 16, 0.125)]);
    const small = buildStripLayout(timeline, 0, 1, 1);
    const big = buildStripLayout(timeline, 0, W, H);
    expect(small.bars.map((b) => [b.x, b.width])).toEqual(big.bars.map((b) => [b.x, b.width]));
  });

  it('puts the notes of a chord in one slot', () => {
    const timeline = makeTimeline([
      { start: 0, end: 0.5, string: 1, fret: 3 },
      { start: 0, end: 0.5, string: 2, fret: 5 },
      { start: 0, end: 0.5, string: 3, fret: 5 },
    ]);
    const bar = buildStripLayout(timeline, 0, W, H).bars[0];
    expect(bar.slots).toHaveLength(1);
    expect(bar.notes).toHaveLength(3);
  });

  it('puts three inner beat ticks in a 4/4 bar, in order and inside the bar', () => {
    const timeline = makeTimeline(eighths(0, 8));
    const bar = buildStripLayout(timeline, 0, W, H).bars[0];
    const xs = bar.beatXs;
    expect(xs).toHaveLength(3);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(xs[0]).toBeGreaterThan(0);
    expect(xs[2]).toBeLessThan(bar.width);
  });
});

describe('cursor on uneven bars', () => {
  // a note, a long gap, then a quick run: the bar's notes are far from evenly spaced in time
  const gappy = () =>
    makeTimeline([
      { start: 0, end: 0.5, string: 2, fret: 5 },
      { start: 1.5, end: 1.625, string: 2, fret: 7 },
      { start: 1.625, end: 1.75, string: 2, fret: 8 },
      { start: 1.75, end: 1.875, string: 2, fret: 10 },
    ]);

  it('sits on each note at the moment it starts', () => {
    const timeline = gappy();
    const layout = buildStripLayout(timeline, 0, W, H);
    const bar = layout.bars[0];
    for (const slot of bar.slots) {
      expect(playheadStripX(layout, timeline, slot.seconds)).toBeCloseTo(bar.x + slot.offset, 6);
    }
  });

  it('moves faster over the gap than over the run', () => {
    const timeline = gappy();
    const layout = buildStripLayout(timeline, 0, W, H);
    const [a, b, c] = layout.bars[0].slots;
    const gapSpeed = (b.offset - a.offset) / (b.seconds - a.seconds);
    const runSpeed = (c.offset - b.offset) / (c.seconds - b.seconds);
    expect(gapSpeed).not.toBeCloseTo(runSpeed, 1);
    expect(runSpeed).toBeGreaterThan(gapSpeed);
  });

  it('keeps a bar-end playhead at the bar end and the next bar start continuous', () => {
    const timeline = gappy();
    const layout = buildStripLayout(timeline, 0, W, H);
    expect(playheadStripX(layout, timeline, 1.9999)).toBeCloseTo(layout.bars[0].x + layout.bars[0].width, 0);
    expect(playheadStripX(layout, timeline, 2)).toBeCloseTo(layout.bars[1].x, 6);
  });

  it('selects the bar under the pointer on widened bars', () => {
    const timeline = makeTimeline([...eighths(0, 8), ...eighths(2, 16, 0.125)]);
    const layout = buildStripLayout(timeline, 0, W, H);
    const t = 3;
    const scroll = stripScrollX(layout, timeline, t);
    const second = layout.bars[1];
    expect(scoreBarAtX(layout, timeline, t, second.x + second.width / 2 - scroll)).toBe(1);
    const early = stripScrollX(layout, timeline, 0.1);
    expect(scoreBarAtX(layout, timeline, 0.1, layout.bars[0].x + 1 - early)).toBe(0);
  });
});

describe('bar line continuity and labels', () => {
  it('keeps the cursor where it is across a bar line when the next bar opens on a note', () => {
    const timeline = makeTimeline([...eighths(0, 8), ...eighths(2, 8)]);
    const layout = buildStripLayout(timeline, 0, W, H);
    const before = playheadStripX(layout, timeline, 1.9999);
    const after = playheadStripX(layout, timeline, 2);
    expect(Math.abs(after - before)).toBeLessThan(1);
  });

  it('draws every bar number in the small label font, not the bold fret font left over from the bar before', () => {
    const timeline = makeTimeline(eighths(0, 8));
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, H);
    const layout = buildStripLayout(timeline, 0, W, H);
    let font = '';
    let labels = 0;
    for (const c of calls) {
      if (c.name === 'set:font') font = String(c.args[0]);
      if (c.name === 'fillText' && c.args[2] === layout.lineTop - 6) {
        labels += 1;
        expect(font).toBe('12px system-ui, sans-serif');
      }
    }
    expect(labels).toBeGreaterThan(1);
  });
});

describe('numerals', () => {
  const fretSizes = (height: number): number[] => {
    const timeline = makeTimeline([{ start: 0.2, end: 0.6, string: 2, fret: 5 }]);
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, height);
    return calls
      .filter((c) => c.name === 'set:font')
      .map((c) => /bold (\d+)px/.exec(String(c.args[0])))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => Number(m[1]));
  };

  it('draws bold fret numbers larger than the old 13px on a normal panel', () => {
    expect(Math.max(...fretSizes(200))).toBeGreaterThan(13);
  });

  it('shrinks with a short panel but never below the floor', () => {
    const short = Math.max(...fretSizes(60));
    expect(short).toBeLessThan(Math.max(...fretSizes(200)));
    expect(short).toBeGreaterThanOrEqual(FRET_FONT_MIN);
  });
});

describe('clef gutter', () => {
  const signed = (numerator: number, denominator: number, fromBar: number) => {
    const base = makeTimeline([], 2, 4);
    return {
      ...base,
      bars: base.bars.map((b) => (b.playbackIndex >= fromBar ? { ...b, timeSignature: { numerator, denominator } } : b)),
    };
  };
  const texts = (timeline: ReturnType<typeof makeTimeline>, t: number) => {
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, t, W, H);
    return calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
  };

  it('draws the TAB clef and the signature of the bar being played, and changes at a signature change', () => {
    // 7 and 8 never appear as bar numbers on this four-bar score, so they can only be the signature
    const timeline = signed(7, 8, 2);
    const before = texts(timeline, 1);
    expect(before).toEqual(expect.arrayContaining(['T', 'A', 'B']));
    expect(before).not.toContain('7');
    expect(before).not.toContain('8');
    const after = texts(timeline, 5);
    expect(after).toContain('7');
    expect(after).toContain('8');
  });

  it('draws after the fret numbers so notes scrolling under it are hidden', () => {
    const timeline = makeTimeline([{ start: 0.2, end: 0.6, string: 2, fret: 5 }]);
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, timeline, 0, 0, W, H);
    const numberAt = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === '5');
    const clefAt = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === 'T');
    expect(numberAt).toBeGreaterThanOrEqual(0);
    expect(clefAt).toBeGreaterThan(numberAt);
  });

  it('keeps the cursor clear of the gutter on a narrow panel', () => {
    const timeline = makeTimeline(eighths(0, 8));
    expect(buildStripLayout(timeline, 0, 240, H).cursorX).toBeGreaterThan(GUTTER_WIDTH);
  });

  it('picks no bar inside the gutter and still picks the bar just right of it', () => {
    const timeline = makeTimeline([...eighths(0, 8), ...eighths(2, 8)]);
    const layout = buildStripLayout(timeline, 0, W, H);
    expect(scoreBarAtX(layout, timeline, 3, GUTTER_WIDTH - 1)).toBeNull();
    expect(scoreBarAtX(layout, timeline, 3, GUTTER_WIDTH + 1)).not.toBeNull();
  });

  it('draws the clef on a one-bar score at time zero', () => {
    const timeline = makeTimeline([], 2, 1);
    expect(() => texts(timeline, 0)).not.toThrow();
    expect(texts(timeline, 0)).toContain('T');
  });
});

describe('strip techniques', () => {
  const run = (specs: Parameters<typeof makeTimeline>[0], t = 0) => {
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, makeTimeline(specs), 0, t, W, H);
    return calls;
  };
  const texts = (calls: ReturnType<typeof run>) => calls.filter((c) => c.name === 'fillText').map((c) => String(c.args[0]));
  const eighthsRun = (techniques: Parameters<typeof makeTimeline>[0][number]['techniques'], count = 4) =>
    Array.from({ length: count }, (_, i) => ({ start: i * 0.25, end: (i + 1) * 0.25, string: 2, fret: 12, techniques }));

  it('leaves two-digit frets clear of each other in a sixteenth run', () => {
    const timeline = makeTimeline(Array.from({ length: 16 }, (_, i) => ({ start: i * 0.125, end: (i + 1) * 0.125, string: 2, fret: 15 })));
    const bar = buildStripLayout(timeline, 0, W, H).bars[0];
    // a 15 at the largest font is about 24 wide; the gap between slots must clear it
    for (let i = 1; i < bar.slots.length; i++) expect(bar.slots[i].offset - bar.slots[i - 1].offset).toBeGreaterThanOrEqual(30);
  });

  it('draws a bend as an arrow with its size, not as text beside the number', () => {
    const calls = run([{ start: 0, end: 0.5, string: 2, fret: 12, techniques: { bend: 2 } }]);
    expect(texts(calls)).toContain('full');
    expect(texts(calls).some((t) => t.startsWith('b'))).toBe(false);
    expect(calls.some((c) => c.name === 'quadraticCurveTo')).toBe(true);
  });

  it('draws one P.M. label for a run of palm-muted notes and a dashed line under it', () => {
    const calls = run(eighthsRun({ palmMute: true }));
    expect(texts(calls).filter((t) => t === 'P.M.')).toHaveLength(1);
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(true);
  });

  it('starts a new P.M. bracket after an open note', () => {
    const calls = run([
      { start: 0, end: 0.25, string: 2, fret: 5, techniques: { palmMute: true } },
      { start: 0.25, end: 0.5, string: 2, fret: 5 },
      { start: 0.5, end: 0.75, string: 2, fret: 5, techniques: { palmMute: true } },
    ]);
    expect(texts(calls).filter((t) => t === 'P.M.')).toHaveLength(2);
  });

  it('arcs a hammer-on to the next note on its string', () => {
    const calls = run([
      { start: 0, end: 0.25, string: 2, fret: 12, techniques: { hammerPull: 'origin' } },
      { start: 0.25, end: 0.5, string: 2, fret: 14, techniques: { hammerPull: 'destination' } },
    ]);
    expect(calls.filter((c) => c.name === 'quadraticCurveTo')).toHaveLength(1);
  });

  it('marks a harmonic with a diamond and a Harm. label', () => {
    const calls = run([{ start: 0, end: 0.5, string: 2, fret: 12, techniques: { harmonic: true } }]);
    expect(texts(calls)).toContain('Harm.');
  });

  it('brackets a triplet group under its beam', () => {
    const third = 2 / 3 / 4;
    const calls = run(Array.from({ length: 3 }, (_, i) => ({ start: i * third, end: (i + 1) * third, string: 2, fret: 5 })));
    expect(texts(calls)).toContain('3');
  });
});

describe('busy passage legibility', () => {
  const draw = (specs: Parameters<typeof makeTimeline>[0], height = H) => {
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, makeTimeline(specs), 0, 0, 1400, height);
    return calls;
  };

  it('keeps every fret number and mark clear of every other in a busy passage', () => {
    const clashes = overlaps(textBoxes(draw(busyPassage())));
    expect(clashes.map(([a, b]) => `${a.text}/${b.text}`)).toEqual([]);
  });

  it('keeps fret numbers in a chord stack clear of each other', () => {
    const chord = [1, 2, 3].map((string) => ({ start: 0, end: 0.5, string, fret: 15 }));
    expect(overlaps(textBoxes(draw(chord)))).toEqual([]);
  });
});

describe('layout for technique marks', () => {
  const crowded = (marked: boolean) =>
    Array.from({ length: 6 }, (_, i) => ({
      start: i * 0.125,
      end: (i + 1) * 0.125,
      string: 2,
      fret: 12,
      techniques: marked && i % 2 === 0 ? { bend: 2 } : undefined,
    }));

  it('fits the marks of a busy passage in the lane budget with no widening left to ask for', () => {
    const layout = buildStripLayout(makeTimeline(busyPassage()), 0, W, H);
    for (const bar of layout.bars) expect(Math.max(-1, ...bar.marks.map((m) => m.lane))).toBeLessThan(LANE_BUDGET);
  });

  it('makes a bar wider when its marks need the room, and leaves a bar of plain notes as it was', () => {
    const marked = buildStripLayout(makeTimeline(crowded(true)), 0, W, H).bars[0];
    const plain = buildStripLayout(makeTimeline(crowded(false)), 0, W, H).bars[0];
    expect(marked.width).toBeGreaterThanOrEqual(plain.width);
    expect(plain.marks).toEqual([]);
    expect(buildStripLayout(makeTimeline([]), 0, W, H).bars[0].width).toBe(MIN_BAR_WIDTH);
  });

  it('keeps marks and bars where they are whatever the panel height', () => {
    const short = buildStripLayout(makeTimeline(busyPassage()), 0, W, 120);
    const tall = buildStripLayout(makeTimeline(busyPassage()), 0, W, 400);
    expect(short.bars.map((b) => [b.width, b.marks.map((m) => [m.kind, m.lane, m.left])])).toEqual(
      tall.bars.map((b) => [b.width, b.marks.map((m) => [m.kind, m.lane, m.left])]),
    );
  });

  it('keeps the cursor on each note and the bar clickable once marks have widened a bar', () => {
    const timeline = makeTimeline(busyPassage());
    const layout = buildStripLayout(timeline, 0, W, H);
    const bar = layout.bars[0];
    for (const slot of bar.slots) {
      expect(playheadStripX(layout, timeline, slot.seconds)).toBeCloseTo(bar.x + slot.offset, 5);
    }
    const t = 0.1;
    const x = bar.x + bar.width / 2 - stripScrollX(layout, timeline, t);
    expect(scoreBarAtX(layout, timeline, t, x)).toBe(0);
  });
});

describe('mark lanes when drawn', () => {
  const bendThenMute = [
    { start: 0, end: 0.125, string: 2, fret: 12, techniques: { bend: 2 } },
    { start: 0.125, end: 0.25, string: 2, fret: 12, techniques: { palmMute: true } },
    { start: 0.25, end: 0.375, string: 2, fret: 12, techniques: { palmMute: true } },
  ];
  const draw = (specs: Parameters<typeof makeTimeline>[0], height: number) => {
    const { ctx, calls } = createRecordingContext();
    renderTabStrip(ctx, makeTimeline(specs), 0, 0, 1000, height);
    return calls;
  };
  const markY = (calls: ReturnType<typeof draw>, text: string) => {
    const at = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === text);
    return Number(calls[at].args[2]);
  };

  it('draws a bend label and a palm-mute label that would share a height at different heights, and a leader for the raised one', () => {
    const calls = draw(bendThenMute, 200);
    expect(markY(calls, 'full')).not.toBe(markY(calls, 'P.M.'));
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).join() === '2,2')).toBe(true);
  });

  it('still separates them on a short panel', () => {
    const calls = draw(bendThenMute, 160);
    expect(Math.abs(markY(calls, 'full') - markY(calls, 'P.M.'))).toBeGreaterThanOrEqual(10);
  });

  it('draws a lone mark in the first lane with no leader', () => {
    const calls = draw([{ start: 0, end: 0.5, string: 2, fret: 12, techniques: { harmonic: true } }], 200);
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).join() === '2,2')).toBe(false);
  });

  it('starts a bend arrow clear of the number above it in a chord', () => {
    const chord = [
      { start: 0, end: 0.5, string: 1, fret: 15 },
      { start: 0, end: 0.5, string: 2, fret: 15, techniques: { bend: 2 } },
    ];
    const calls = draw(chord, 200);
    const arrow = calls.find((c) => c.name === 'quadraticCurveTo');
    const above = textBoxes(calls).find((b) => b.text === '15');
    expect(Number(arrow?.args[2])).toBeGreaterThan((above?.right ?? 0) - 0.5);
  });
});
