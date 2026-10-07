import { describe, expect, it } from 'vitest';
import { photoNoteX, photoPlacement, photoRingRadius, photoStringY, photoToScreen, renderNeckFrame, renderNeckView, type PhotoContext } from '../../src/render/neck-view';
import { emphasisAt } from '../../src/render/emphasis';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1920;
const H = 1080;

function draw(specs: NoteSpec[], t: number, cues: boolean | undefined, w = W, h = H, stringCount = 6): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderNeckView(ctx, makeTimeline(specs, 2, 4, stringCount), 0, t, w, h, cues === undefined ? {} : { techniqueCues: cues });
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

describe('a video frame and a live frame', () => {
  it('covers AE6: draw the same calls for the same moment, with the cues on and with them off', () => {
    const image = {} as CanvasImageSource;
    const timeline = makeTimeline(withTechniques);
    for (const cues of [true, false]) {
      const live = createRecordingContext();
      renderNeckView(live.ctx, timeline, 0, 1.7, W, H, { techniqueCues: cues });
      const frame = createRecordingContext();
      renderNeckFrame(frame.ctx as PhotoContext, image, timeline, 0, 1.7, W, H, { techniqueCues: cues });
      const afterPhoto = frame.calls.slice(frame.calls.findIndex((c) => c.name === 'restore') + 1);
      expect(afterPhoto).toEqual(live.calls);
    }
  });

  it('shows the cues in the frame only when asked', () => {
    const image = {} as CanvasImageSource;
    const timeline = makeTimeline(withTechniques);
    const arcsIn = (techniqueCues: boolean) => {
      const { ctx, calls } = createRecordingContext();
      renderNeckFrame(ctx as PhotoContext, image, timeline, 0, 1.2, W, H, { techniqueCues });
      return named(calls, 'quadraticCurveTo').length;
    };
    expect(arcsIn(true)).toBeGreaterThan(0);
    expect(arcsIn(false)).toBe(0);
  });
});

describe('the ring as the finger', () => {
  const bend = (string: number, semitones: number, fret = 7): NoteSpec[] => [{ start: 1, end: 2, string, fret, techniques: { bend: semitones } }];
  /** The centre of the playing note's ring: the last ring or ellipse traced, less any traced after it by cues. */
  const ring = (calls: Call[], after = 0) => {
    const traced = calls.filter((c) => c.name === 'arc' || c.name === 'ellipse');
    const last = traced[traced.length - 1 - after];
    return { x: last.args[0] as number, y: last.args[1] as number, name: last.name, args: last.args };
  };
  const rest = (string: number, fret: number, w = W, h = H, count = 6) => {
    const place = photoPlacement(w, h);
    const px = photoNoteX(fret);
    return photoToScreen(place, px, photoStringY(string, count, px));
  };

  it('covers AE1: bends the B string toward low E and the A string toward high e', () => {
    const b = ring(draw(bend(2, 2), 1.9, true));
    const a = ring(draw(bend(5, 2), 1.9, true));
    // in the wide layout high e is at the top, so toward low E is down the screen
    expect(b.y).toBeGreaterThan(rest(2, 7).y + 1);
    expect(a.y).toBeLessThan(rest(5, 7).y - 1);
    expect(b.x).toBeCloseTo(rest(2, 7).x, 6);
  });

  it('puts the bend the right way for a four-string bass', () => {
    const upper = ring(draw(bend(2, 2), 1.9, true, W, H, 4));
    const lower = ring(draw(bend(3, 2), 1.9, true, W, H, 4));
    expect(upper.y).toBeGreaterThan(rest(2, 7, W, H, 4).y + 1);
    expect(lower.y).toBeLessThan(rest(3, 7, W, H, 4).y - 1);
  });

  it('turns the same bends the right way on screen in the upright layout, where high e is on the right', () => {
    const b = ring(draw(bend(2, 2), 1.9, true, 1080, 1920));
    const a = ring(draw(bend(5, 2), 1.9, true, 1080, 1920));
    expect(b.x).toBeLessThan(rest(2, 7, 1080, 1920).x - 1);
    expect(a.x).toBeGreaterThan(rest(5, 7, 1080, 1920).x + 1);
  });

  it('covers AE2: stretches the ring of a bend and starts the lit string at the displaced ring', () => {
    const calls = draw(bend(3, 2), 1.9, true);
    const r = ring(calls);
    expect(r.name).toBe('ellipse');
    const [, , rx, ry] = r.args as number[];
    expect(Math.max(rx, ry)).toBeGreaterThan(Math.min(rx, ry) * 1.2);
    const starts = named(calls, 'moveTo').map((c) => ({ x: c.args[0] as number, y: c.args[1] as number }));
    expect(starts.some((p) => Math.abs(p.x - r.x) < 1e-6 && Math.abs(p.y - r.y) < 1e-6)).toBe(true);
  });

  it('eases the lit string back to straight at the bridge', () => {
    const end = (specs: NoteSpec[], t: number) => {
      const points = lines(draw(specs, t, true));
      return points[points.length - 1];
    };
    const straight = end([{ start: 1, end: 2, string: 3, fret: 7 }], 1.9);
    const bent = end(bend(3, 2), 1.9);
    expect(bent.y).toBeCloseTo(straight.y, 6);
  });

  it('covers AE3: moves the ring of a half-step bend about half as far as a full-step bend', () => {
    const at = (semitones: number) => ring(draw(bend(2, semitones), 1.9, true)).y - rest(2, 7).y;
    expect(at(1) / at(2)).toBeCloseTo(0.5, 6);
  });

  it('covers AE4: rocks the ring of a vibrato note and settles it after the note', () => {
    const note: NoteSpec[] = [{ start: 1, end: 3, string: 3, fret: 7, techniques: { vibrato: true } }];
    const t = 1.5 + 1 / 28;
    const up = ring(draw(note, t, true)).y;
    const down = ring(draw(note, t + 1 / 14, true)).y;
    expect(up).not.toBeCloseTo(down, 3);
    expect(Math.abs(up - rest(3, 7).y)).toBeGreaterThan(0.5);
    expect(ring(draw(note, 3.3, true)).y).toBeCloseTo(rest(3, 7).y, 6);
  });

  it('covers AE4: carries the ring along a slide', () => {
    const slide: NoteSpec[] = [
      { start: 1, end: 2, string: 4, fret: 5, techniques: { slide: 'shift' } },
      { start: 2, end: 2.5, string: 4, fret: 9 },
    ];
    // the comet's head and the arrival pulse add seven arcs after the ring
    expect(ring(draw(slide, 1.5, true), 7).x).toBeCloseTo(rest(4, 7).x, 6);
    expect(ring(draw(slide, 1.5, false)).x).toBeCloseTo(rest(4, 5).x, 6);
  });

  it('shrinks the ring a moment as a hammer-on lands and leaves it round', () => {
    const notes: NoteSpec[] = [
      { start: 1, end: 1.5, string: 3, fret: 5, techniques: { hammerPull: 'origin' } },
      { start: 1.5, end: 2, string: 3, fret: 7, techniques: { hammerPull: 'destination' } },
    ];
    const radius = (t: number) => arcs(draw(notes, t, true)).filter((a) => a.alpha > 0.5).pop()!.r;
    expect(radius(1.52)).toBeLessThan(radius(1.9));
  });

  it('covers AE5: draws a plain note the same with the cues on as off', () => {
    const plainNote: NoteSpec[] = [{ start: 1, end: 2, string: 3, fret: 7 }];
    for (const t of [0.8, 1.5, 2.2]) expect(draw(plainNote, t, true)).toEqual(draw(plainNote, t, false));
  });

  it('keeps the diamond of a harmonic on the displaced ring', () => {
    const calls = draw([{ start: 1, end: 2, string: 3, fret: 7, techniques: { bend: 2, harmonic: true } }], 1.9, true);
    const r = ring(calls);
    const size = photoRingRadius(7) * photoPlacement(W, H).scale * 1.5;
    const tops = named(calls, 'moveTo').filter((c) => Math.abs((c.args[0] as number) - r.x) < 1e-6 && Math.abs((c.args[1] as number) - (r.y - size)) < 1e-6);
    expect(tops.length).toBeGreaterThan(0);
  });
});
