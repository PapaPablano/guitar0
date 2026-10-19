import { describe, expect, it } from 'vitest';
import type { BarEvent } from '../../src/model/score';
import { FLASH_SECONDS, PLUCK_SECONDS, STRUM_SECONDS, pickAt, pickPlan, pluckAt } from '../../src/render/pick-cues';
import { makeTimeline } from '../helpers/make-timeline';

const strokes = (specs: Parameters<typeof makeTimeline>[0], bars?: readonly BarEvent[]) =>
  pickPlan(makeTimeline(specs).notesForTrack(0), bars).steps.map((s) => s.stroke);

describe('the stroke of each picked step', () => {
  it('alternates down on the beat and up off it for unmarked single notes', () => {
    // 120 bpm: a beat is 0.5 s, so these eighth notes sit on and off the beat
    expect(strokes([0, 0.25, 0.5, 0.75].map((start) => ({ start, end: start + 0.2 })))).toEqual(['down', 'up', 'down', 'up']);
  });

  it('counts the beat from the start of each bar when the bars are given (5/8 then 6/8)', () => {
    const bar = (i: number, startTick: number, endTick: number): BarEvent => ({
      playbackIndex: i,
      scoreBar: i,
      startSeconds: startTick / 1920,
      endSeconds: endTick / 1920,
      startTick,
      endTick,
      tempo: 120,
      timeSignature: { numerator: i === 0 ? 5 : 6, denominator: 8 },
    });
    const bars = [bar(0, 0, 2400), bar(1, 2400, 5280)];
    // the second bar starts on tick 2400, which is not a multiple of a quarter note; its first note is still on the beat
    const specs = [{ start: 2400 / 1920, end: 2400 / 1920 + 0.1 }, { start: 2880 / 1920, end: 2880 / 1920 + 0.1 }].map((s, i) => ({ ...s, string: 1 + i }));
    const notes = makeTimeline(specs).notesForTrack(0).map((n) => ({ ...n, playbackBar: 1 }));
    expect(pickPlan(notes, bars).steps.map((s) => s.stroke)).toEqual(['down', 'up']);
  });

  it('plays an unmarked chord as a down stroke', () => {
    expect(strokes([{ start: 0.25, end: 0.5, string: 2 }, { start: 0.25, end: 0.5, string: 3 }, { start: 0.25, end: 0.5, string: 4 }])).toEqual(['down']);
  });

  it('keeps the strokes the file marks, even against the beat', () => {
    const marked = strokes([
      { start: 0, end: 0.2, stroke: 'up' },
      { start: 0.25, end: 0.45, stroke: 'down' },
      { start: 0.5, end: 0.7, string: 2, stroke: 'up' },
      { start: 0.5, end: 0.7, string: 3, stroke: 'up' },
    ]);
    expect(marked).toEqual(['up', 'down', 'up']);
  });

  it('leaves out notes that are not picked: a hammer-on or pull-off destination, and a tied note', () => {
    const specs = [
      { start: 0, end: 0.2 },
      { start: 0.25, end: 0.45, techniques: { hammerPull: 'destination' as const } },
      { start: 0.5, end: 0.7, techniques: { tied: true } },
      { start: 0.75, end: 0.95 },
    ];
    const plan = pickPlan(makeTimeline(specs).notesForTrack(0));
    expect(plan.steps).toHaveLength(2);
    expect(plan.arrival.has('n1')).toBe(false);
    expect(plan.arrival.has('n2')).toBe(false);
  });
});

describe('where the pick is', () => {
  const run = pickPlan(
    makeTimeline([
      { start: 1, end: 1.4, string: 2 },
      { start: 2, end: 2.4, string: 5 },
    ]).notesForTrack(0),
  );

  it('rests across the middle of the strings before the first note', () => {
    expect(pickAt(run, 0).string).toBeCloseTo(3.5, 9);
    expect(pickAt(run, 0).moving).toBe(false);
  });

  it('is on a picked note string at its start', () => {
    expect(pickAt(run, 1).string).toBeCloseTo(2, 9);
    expect(pickAt(run, 2).string).toBeCloseTo(5, 9);
  });

  it('stays on the last picked string, then travels to the next one so it arrives as that note starts', () => {
    expect(pickAt(run, 1.5).string).toBeCloseTo(2, 9);
    const mid = pickAt(run, 2 - 0.05);
    expect(mid.string).toBeGreaterThan(2);
    expect(mid.string).toBeLessThan(5);
    expect(mid.moving).toBe(true);
  });

  it('is a pure function of the time', () => {
    expect(pickAt(run, 1.97)).toEqual(pickAt(run, 1.97));
    pickAt(run, 3);
    expect(pickAt(run, 1.97)).toEqual(pickAt(run, 1.97));
  });
});

describe('a chord', () => {
  const chord = (stroke?: 'up' | 'down') =>
    pickPlan(makeTimeline([2, 3, 4].map((string) => ({ start: 1, end: 1.6, string, ...(stroke ? { stroke } : {}) }))).notesForTrack(0));

  it('is crossed from the lowest-pitched string to the highest on a down stroke, a flash on each in turn', () => {
    const plan = chord('down');
    const at = (id: string) => plan.arrival.get(id) as number;
    // n0, n1, n2 are strings 2, 3, 4: the lowest-pitched is string 4
    expect(at('n2')).toBeLessThan(at('n1'));
    expect(at('n1')).toBeLessThan(at('n0'));
    expect(at('n0') - at('n2')).toBeCloseTo(STRUM_SECONDS, 6);
  });

  it('is crossed from the highest-pitched string to the lowest on an up stroke', () => {
    const plan = chord('up');
    const at = (id: string) => plan.arrival.get(id) as number;
    expect(at('n0')).toBeLessThan(at('n1'));
    expect(at('n1')).toBeLessThan(at('n2'));
    expect(pickAt(plan, at('n1')).string).toBeCloseTo(3, 6);
  });

  it('flashes each string as the pick reaches it, and fades within the flash time', () => {
    const plan = chord('down');
    const first = plan.arrival.get('n2') as number;
    const now = pickAt(plan, first);
    expect(now.flashes.map((f) => f.note.id)).toEqual(['n2']);
    expect(now.flashes[0].strength).toBeCloseTo(1, 6);
    expect(pickAt(plan, first + FLASH_SECONDS + 0.01).flashes.filter((f) => f.note.id === 'n2')).toHaveLength(0);
  });
});

describe('the pluck wobble', () => {
  const plan = pickPlan(
    makeTimeline([
      { start: 1, end: 1.5, string: 3 },
      { start: 2, end: 2.5, string: 3, techniques: { hammerPull: 'destination' } },
    ]).notesForTrack(0),
  );
  const [picked, hammered] = makeTimeline([
    { start: 1, end: 1.5, string: 3 },
    { start: 2, end: 2.5, string: 3, techniques: { hammerPull: 'destination' } },
  ]).notesForTrack(0);

  it('starts at full pull as the note is picked and settles within the pluck time', () => {
    expect(Math.abs(pluckAt(plan, picked, 1))).toBeCloseTo(1, 6);
    expect(Math.abs(pluckAt(plan, picked, 1 + PLUCK_SECONDS * 0.5))).toBeLessThan(1);
    expect(pluckAt(plan, picked, 1 + PLUCK_SECONDS)).toBe(0);
    expect(pluckAt(plan, picked, 1 - 0.01)).toBe(0);
  });

  it('pulls the string toward the lower-pitched side on a down stroke and the other way on an up stroke', () => {
    const up = pickPlan(makeTimeline([{ start: 1, end: 1.5, string: 3, stroke: 'up' }]).notesForTrack(0));
    const [upNote] = makeTimeline([{ start: 1, end: 1.5, string: 3, stroke: 'up' }]).notesForTrack(0);
    const down = pluckAt(plan, picked, 1);
    expect(down).toBeGreaterThan(0);
    expect(pluckAt(up, upNote, 1)).toBeLessThan(0);
  });

  it('never shakes a note that is not picked', () => {
    for (const t of [2, 2.05, 2.2]) expect(pluckAt(plan, hammered, t)).toBe(0);
  });
});
