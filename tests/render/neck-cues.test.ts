import { describe, expect, it } from 'vitest';
import { photoNoteX, photoPlacement, photoRingRadius, photoStringY, photoToScreen, renderNeckView } from '../../src/render/neck-view';
import { emphasisAt } from '../../src/render/emphasis';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1920;
const H = 1080;

function draw(specs: NoteSpec[], t: number, cues: boolean | undefined, w = W, h = H): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderNeckView(ctx, makeTimeline(specs), 0, t, w, h, cues === undefined ? {} : { techniqueCues: cues });
  return calls;
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
const arcs = (calls: Call[]) => named(calls, 'arc').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number, r: c.args[2] as number, alpha: c.alpha }));
const lines = (calls: Call[]) => named(calls, 'lineTo').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));

/** Every technique at once, the notes plain apart from the technique. */
const withTechniques: NoteSpec[] = [
  { start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'origin' } },
  { start: 1.5, end: 2, string: 3, fret: 7, techniques: { hammerPull: 'destination' } },
  { start: 2, end: 3, string: 4, fret: 5, techniques: { slide: 'shift' } },
  { start: 3, end: 4, string: 4, fret: 9, techniques: { bend: 2, vibrato: true } },
  { start: 4, end: 5, string: 5, fret: 3, techniques: { palmMute: true } },
  { start: 5, end: 6, string: 1, fret: 12, techniques: { harmonic: true } },
];
const plain: NoteSpec[] = withTechniques.map((s) => ({ ...s, techniques: undefined }));

describe('with the cues off', () => {
  it('covers AE6: draws the same calls absent or false, whatever techniques the notes carry', () => {
    for (const t of [0.5, 1.2, 1.7, 2.5, 3.5, 4.5, 5.5]) {
      const absent = draw(withTechniques, t, undefined);
      expect(draw(withTechniques, t, false)).toEqual(absent);
      expect(draw(plain, t, undefined)).toEqual(absent);
    }
  });
});

describe('hammer-ons and pull-offs', () => {
  const hammer: NoteSpec[] = [
    { start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'origin' } },
    { start: 1.5, end: 2, string: 3, fret: 7, techniques: { hammerPull: 'destination' } },
  ];

  it('covers AE1: adds an arc between the two rings', () => {
    expect(named(draw(hammer, 1.2, true), 'quadraticCurveTo').length).toBeGreaterThan(0);
    expect(named(draw(hammer, 1.2, false), 'quadraticCurveTo')).toHaveLength(0);
  });

  it('the arc runs from the origin ring to the destination ring', () => {
    const place = photoPlacement(W, H);
    const a = photoToScreen(place, photoNoteX(5), photoStringY(3, 6, photoNoteX(5)));
    const b = photoToScreen(place, photoNoteX(7), photoStringY(3, 6, photoNoteX(7)));
    const calls = draw(hammer, 1.2, true);
    const moves = named(calls, 'moveTo').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
    const curve = named(calls, 'quadraticCurveTo')[0];
    const start = moves[moves.length - 1];
    const rA = photoRingRadius(5) * place.scale;
    expect(Math.hypot(start.x - a.x, start.y - a.y)).toBeCloseTo(rA, 3);
    const end = { x: curve.args[2] as number, y: curve.args[3] as number };
    expect(Math.hypot(end.x - b.x, end.y - b.y)).toBeCloseTo(photoRingRadius(7) * place.scale, 3);
  });

  it('draws the note it ends on as a softer ring with no halo or pop', () => {
    const only: NoteSpec[] = [{ start: 1, end: 2, string: 3, fret: 7, techniques: { hammerPull: 'destination' } }];
    const picked: NoteSpec[] = [{ start: 1, end: 2, string: 3, fret: 7 }];
    // a picked note sounding draws two halo rings and its ring; the unpicked one draws only a ring
    expect(arcs(draw(picked, 1.1, true))).toHaveLength(3);
    const soft = arcs(draw(only, 1.1, true));
    expect(soft).toHaveLength(1);
    const place = photoPlacement(W, H);
    expect(soft[0].r).toBeLessThan(photoRingRadius(7) * place.scale * emphasisAt(1, 2, 1.1).scale);
    // the ring is the last arc traced, and its outline is stroked right after at the ring's strength
    const strength = (calls: Call[]) => calls.slice(calls.map((c) => c.name).lastIndexOf('arc')).find((c) => c.name === 'stroke')!.alpha;
    expect(strength(draw(only, 1.1, true))).toBeLessThan(strength(draw(picked, 1.1, true)));
  });
});

describe('slides', () => {
  const slide: NoteSpec[] = [
    { start: 1, end: 2, string: 4, fret: 5, techniques: { slide: 'shift' } },
    { start: 2, end: 2.5, string: 4, fret: 9 },
  ];

  it('covers AE2: adds a comet whose head is further along later in the note', () => {
    const headAt = (t: number) => {
      const on = arcs(draw(slide, t, true));
      const off = arcs(draw(slide, t, false));
      return on.filter((a) => !off.some((o) => Math.abs(o.x - a.x) < 1e-9 && Math.abs(o.y - a.y) < 1e-9 && Math.abs(o.r - a.r) < 1e-9));
    };
    const early = headAt(1.2);
    const late = headAt(1.8);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    expect(late[late.length - 1].x).toBeGreaterThan(early[early.length - 1].x);
  });

  it('draws no comet for a note with no slide', () => {
    const noSlide: NoteSpec[] = [{ start: 1, end: 2, string: 4, fret: 5 }, { start: 2, end: 2.5, string: 4, fret: 5 }];
    expect(arcs(draw(noSlide, 1.5, true))).toEqual(arcs(draw(noSlide, 1.5, false)));
  });
});

describe('bend, vibrato and palm mute', () => {
  const note = (techniques: NoteSpec['techniques']): NoteSpec[] => [{ start: 1, end: 2, string: 3, fret: 5, techniques }];
  /** Where the lit string ends, at the bridge. */
  const bridgeY = (specs: NoteSpec[], t: number) => {
    const points = lines(draw(specs, t, true));
    return points[points.length - 1].y;
  };

  it('covers AE3: bends the lit string away from the lower strings, a full bend more than a half step, and not at all without a bend', () => {
    const straight = bridgeY(note(undefined), 1.9);
    const half = bridgeY(note({ bend: 1 }), 1.9);
    const full = bridgeY(note({ bend: 2 }), 1.9);
    expect(half).toBeLessThan(straight);
    expect(full).toBeLessThan(half);
    expect(straight - full).toBeCloseTo(2 * (straight - half), 3);
  });

  it('draws the bent string as a curve of many points', () => {
    expect(lines(draw(note({ bend: 2 }), 1.9, true)).length).toBeGreaterThan(lines(draw(note(undefined), 1.9, true)).length + 20);
  });

  it('shivers a vibrato note, so the string differs a moment later, and is straight again when it ends', () => {
    const a = lines(draw(note({ vibrato: true }), 1.5, true));
    const b = lines(draw(note({ vibrato: true }), 1.53, true));
    expect(a).not.toEqual(b);
    const straight = lines(draw(note(undefined), 2.4, true));
    expect(lines(draw(note({ vibrato: true }), 2.4, true))).toEqual(straight);
  });

  it('covers AE4: lights a palm-muted note\'s string at half the strength', () => {
    const strokeAlphas = (specs: NoteSpec[]) => named(draw(specs, 1.5, true), 'stroke').map((c) => Math.round(c.alpha * 1000) / 1000);
    expect(strokeAlphas(note(undefined))).toContain(0.95);
    expect(strokeAlphas(note({ palmMute: true }))).not.toContain(0.95);
    expect(strokeAlphas(note({ palmMute: true }))).toContain(0.475);
  });

  it('draws the ring of a palm-muted note with a thinner outline', () => {
    const widths = (specs: NoteSpec[]) => {
      const calls = draw(specs, 1.5, true);
      const at = calls.findIndex((c) => c.name === 'arc' && c.alpha > 0.5);
      return calls.slice(at).find((c) => c.name === 'set:lineWidth')?.args[0] as number;
    };
    expect(widths(note({ palmMute: true }))).toBeLessThan(widths(note(undefined)));
  });
});

describe('harmonics', () => {
  it('covers AE4: adds a four-sided outline around the ring of a harmonic', () => {
    const specs = (harmonic: boolean): NoteSpec[] => [{ start: 1, end: 2, string: 2, fret: 12, techniques: { harmonic } }];
    expect(named(draw(specs(true), 1.5, true), 'closePath')).toHaveLength(named(draw(specs(false), 1.5, true), 'closePath').length + 1);
  });
});

describe('the pulse', () => {
  const specs: NoteSpec[] = [
    { start: 1, end: 2, string: 3, fret: 5 },
    { start: 3, end: 4, string: 3, fret: 12 },
  ];
  const extra = (t: number) => {
    const on = arcs(draw(specs, t, true));
    const off = arcs(draw(specs, t, false));
    return on.filter((a) => !off.some((o) => o.x === a.x && o.y === a.y && o.r === a.r));
  };

  it('covers AE5: draws a dot that moves from the playing ring toward the next ring as time passes', () => {
    const place = photoPlacement(W, H);
    const a = photoToScreen(place, photoNoteX(5), photoStringY(3, 6, photoNoteX(5)));
    const b = photoToScreen(place, photoNoteX(12), photoStringY(3, 6, photoNoteX(12)));
    const early = extra(1.5);
    const late = extra(2.7);
    expect(early.length).toBeGreaterThan(0);
    const headEarly = early[early.length - 2];
    const headLate = late[late.length - 2];
    expect(headLate.x).toBeGreaterThan(headEarly.x);
    expect(headEarly.x).toBeGreaterThan(a.x);
    expect(headLate.x).toBeLessThan(b.x + 1e-6);
  });

  it('draws none when the next note is at the same position', () => {
    const same: NoteSpec[] = [
      { start: 1, end: 2, string: 3, fret: 5 },
      { start: 2, end: 3, string: 3, fret: 5 },
    ];
    expect(arcs(draw(same, 1.5, true))).toEqual(arcs(draw(same, 1.5, false)));
  });

  it('keeps the dot on the line between the two rings on a tall screen too', () => {
    const w = 540;
    const h = 1170;
    const place = photoPlacement(w, h);
    const a = photoToScreen(place, photoNoteX(5), photoStringY(3, 6, photoNoteX(5)));
    const b = photoToScreen(place, photoNoteX(12), photoStringY(3, 6, photoNoteX(12)));
    const on = arcs(draw(specs, 2.4, true, w, h));
    const off = arcs(draw(specs, 2.4, false, w, h));
    const dot = on.filter((p) => !off.some((o) => o.x === p.x && o.y === p.y && o.r === p.r))[0];
    const cross = (b.x - a.x) * (dot.y - a.y) - (b.y - a.y) * (dot.x - a.x);
    expect(Math.abs(cross) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(1e-6);
  });
});

describe('no text', () => {
  it('covers AE7: every cue on at once draws no more text than the neck draws with them off', () => {
    for (const t of [1.2, 1.7, 2.5, 3.5, 4.5, 5.5]) {
      const text = (cues: boolean) => named(draw(withTechniques, t, cues), 'fillText').map((c) => c.args[0]);
      expect(text(true)).toEqual(text(false));
    }
  });
});

describe('the cues over a whole song', () => {
  it('draws the same calls twice for the same time', () => {
    expect(draw(withTechniques, 3.5, true)).toEqual(draw(withTechniques, 3.5, true));
  });

  it('draws nothing extra for plain notes', () => {
    for (const t of [1.2, 2.5, 4.5]) expect(draw(plain, t, true).filter((c) => c.name === 'quadraticCurveTo')).toHaveLength(0);
  });
});
