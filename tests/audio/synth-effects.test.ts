import { describe, expect, it, vi } from 'vitest';
import {
  buildEffects,
  CEILING_KNEE,
  CROSSFADE_SECONDS,
  DEFAULT_EFFECTS,
  installLiveEffects,
  renderWithEffects,
  roomImpulse,
  softClipCurve,
} from '../../src/audio/synth-effects';

/** A stand-in audio parameter that records what was scheduled on it. */
class FakeParam {
  events: { kind: 'set' | 'ramp' | 'cancel'; value: number; time: number }[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'ramp', value, time });
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', value: Number.NaN, time });
  }
  /** Where the last ramp ends, or the plain value when nothing is scheduled. */
  target() {
    const ramps = this.events.filter((e) => e.kind === 'ramp');
    return ramps.length > 0 ? ramps[ramps.length - 1] : { kind: 'none', value: this.value, time: 0 };
  }
}

/** A stand-in audio node that records its kind, settings and connections. */
class FakeNode {
  connections: FakeNode[] = [];
  gain = new FakeParam(1);
  frequency = { value: 0 };
  type = '';
  buffer: { length: number; channels: Float32Array[] } | null = null;
  curve: Float32Array | null = null;
  oversample = 'none';
  constructor(readonly kind: string) {}
  connect(to: FakeNode) {
    this.connections.push(to);
    return to;
  }
  disconnect() {
    this.connections = [];
  }
}

class FakeContext {
  destination = new FakeNode('destination');
  currentTime = 2;
  constructor(readonly sampleRate = 48000) {}
  createGain = () => new FakeNode('gain');
  createBiquadFilter = () => new FakeNode('biquad');
  createConvolver = () => new FakeNode('convolver');
  createWaveShaper = () => new FakeNode('shaper');
  createBuffer = (_channels: number, length: number) => {
    const channels = [new Float32Array(length), new Float32Array(length)];
    return { length, copyToChannel: (data: Float32Array, c: number) => channels[c].set(data), channels };
  };
}

const asContext = (c: FakeContext) => c as unknown as BaseAudioContext;

/** Every node reachable from `start`, in the order the signal meets them. */
function walk(start: FakeNode): FakeNode[] {
  const seen: FakeNode[] = [];
  const visit = (n: FakeNode) => {
    if (seen.includes(n)) return;
    seen.push(n);
    n.connections.forEach(visit);
  };
  visit(start);
  return seen;
}

const describeNode = (n: FakeNode) => ({ kind: n.kind, type: n.type, gain: n.gain.value, hz: n.frequency.value, over: n.oversample, buffer: n.buffer?.length ?? null });

describe('roomImpulse', () => {
  it('gives the same room for the same inputs, and a different one for a different seed', () => {
    const [a] = roomImpulse(48000, 0.5, 7);
    const [b] = roomImpulse(48000, 0.5, 7);
    const [c] = roomImpulse(48000, 0.5, 8);
    expect(Array.from(a.slice(0, 200))).toEqual(Array.from(b.slice(0, 200)));
    expect(Array.from(a.slice(0, 200))).not.toEqual(Array.from(c.slice(0, 200)));
  });

  it('has the asked length, stays finite and in range, and dies away to nothing', () => {
    const [left, right] = roomImpulse(48000, 1.2);
    expect(left.length).toBe(Math.floor(48000 * 1.2));
    expect(right.length).toBe(left.length);
    const energy = (data: Float32Array, from: number, to: number) => data.slice(from, to).reduce((s, x) => s + x * x, 0);
    for (const x of left) expect(Math.abs(x)).toBeLessThanOrEqual(1);
    expect(energy(left, left.length - 2000, left.length)).toBeLessThan(energy(left, 0, 2000) * 1e-6);
  });
});

describe('softClipCurve', () => {
  it('never reaches full scale, rises with the input and is silent at zero', () => {
    const curve = softClipCurve();
    expect(Math.max(...Array.from(curve).map(Math.abs))).toBeLessThan(1);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThan(curve[i - 1]);
    expect(Math.abs(curve[Math.floor(curve.length / 2)])).toBeLessThan(0.001);
  });

  it('leaves the signal unchanged below the knee (R12): no lift and no saturation at normal levels', () => {
    expect(CEILING_KNEE).toBeGreaterThanOrEqual(0.5);
    expect(CEILING_KNEE).toBeLessThan(1);
    for (const points of [2048, 1025]) {
      const curve = softClipCurve(points);
      let checked = 0;
      for (let i = 0; i < points; i++) {
        const x = (i / (points - 1)) * 2 - 1;
        if (Math.abs(x) > CEILING_KNEE) continue;
        expect(curve[i]).toBeCloseTo(x, 6);
        checked++;
      }
      expect(checked).toBeGreaterThan(points / 2);
    }
  });

  it('bends smoothly above the knee and stays under full scale for any input', () => {
    const points = 2048;
    const curve = softClipCurve(points);
    // The Web Audio shaper holds its end values for inputs past full scale, so the ends bound every input.
    expect(curve[points - 1]).toBeLessThan(1 - 1e-3);
    expect(curve[0]).toBeGreaterThan(-1 + 1e-3);
    for (let i = 0; i < points; i++) expect(curve[i]).toBeCloseTo(-curve[points - 1 - i], 6);
    // No kink at the knee: the slope just above it is still close to 1.
    const step = 2 / (points - 1);
    const above = Math.ceil(((CEILING_KNEE + 1) / 2) * (points - 1)) + 1;
    expect((curve[above + 1] - curve[above]) / step).toBeGreaterThan(0.95);
  });
});

describe('buildEffects', () => {
  it('builds the same chain on a live and an offline context', () => {
    const live = buildEffects(asContext(new FakeContext()));
    const offline = buildEffects(asContext(new FakeContext()));
    const shape = (chain: { input: AudioNode }) => walk(chain.input as unknown as FakeNode).map(describeNode);
    expect(shape(live)).toEqual(shape(offline));
    expect(shape(live).length).toBeGreaterThan(6);
  });

  it('carries the EQ, the room and the ceiling', () => {
    const chain = buildEffects(asContext(new FakeContext()));
    const nodes = walk(chain.input as unknown as FakeNode);
    const biquads = nodes.filter((n) => n.kind === 'biquad').map((n) => n.type);
    expect(biquads).toEqual(['highpass', 'lowshelf', 'highshelf']);
    expect(nodes.some((n) => n.kind === 'convolver' && n.buffer && n.buffer.length > 0)).toBe(true);
    const shaper = nodes.find((n) => n.kind === 'shaper')!;
    expect(shaper.oversample).toBe('2x');
    // The ceiling is on the processed path, which meets the plain path at the output.
    expect(walk(shaper)).toContain(chain.output as unknown as FakeNode);
  });

  it('mixes the dry and room signals so they add up to the whole', () => {
    const nodes = walk(buildEffects(asContext(new FakeContext())).input as unknown as FakeNode);
    const gains = nodes.filter((n) => n.kind === 'gain').map((n) => n.gain.value);
    expect(gains).toContain(1 - DEFAULT_EFFECTS.roomMix);
    expect(gains).toContain(DEFAULT_EFFECTS.roomMix);
  });

  /** The plain path (input straight to the output) and the processed path's last gain (after the ceiling). */
  function paths(chain: { input: AudioNode; output: AudioNode }) {
    const input = chain.input as unknown as FakeNode;
    const output = chain.output as unknown as FakeNode;
    const plain = input.connections.find((n) => n.kind === 'gain' && n.connections.includes(output));
    const shaper = walk(input).find((n) => n.kind === 'shaper');
    const processed = shaper?.connections.find((n) => n.kind === 'gain');
    if (!plain || !processed) throw new Error('the chain has no plain and processed paths');
    expect(processed.connections).toContain(output);
    return { plain, processed };
  }

  it('starts with only the processed sound when on, and only the plain sound when off', () => {
    const on = paths(buildEffects(asContext(new FakeContext())));
    expect(on.plain.gain.value).toBe(0);
    expect(on.processed.gain.value).toBe(1);
    const off = paths(buildEffects(asContext(new FakeContext()), false));
    expect(off.plain.gain.value).toBe(1);
    expect(off.processed.gain.value).toBe(0);
  });

  it('switching off crossfades to the plain sound over a few milliseconds, without rebuilding the chain (KTD7)', () => {
    const ctx = new FakeContext();
    const chain = buildEffects(asContext(ctx));
    const before = walk(chain.input as unknown as FakeNode);
    const { plain, processed } = paths(chain);
    expect(CROSSFADE_SECONDS).toBeGreaterThan(0.001);
    expect(CROSSFADE_SECONDS).toBeLessThanOrEqual(0.03);

    chain.setEnabled(false);
    // Each ramp starts from where the gain is now, so a flip mid-fade does not jump.
    expect(processed.gain.events.find((e) => e.kind === 'set')).toEqual({ kind: 'set', value: 1, time: ctx.currentTime });
    expect(processed.gain.target()).toEqual({ kind: 'ramp', value: 0, time: ctx.currentTime + CROSSFADE_SECONDS });
    expect(plain.gain.target()).toEqual({ kind: 'ramp', value: 1, time: ctx.currentTime + CROSSFADE_SECONDS });

    ctx.currentTime = 5;
    chain.setEnabled(true);
    expect(processed.gain.target()).toEqual({ kind: 'ramp', value: 1, time: 5 + CROSSFADE_SECONDS });
    expect(plain.gain.target()).toEqual({ kind: 'ramp', value: 0, time: 5 + CROSSFADE_SECONDS });

    const after = walk(chain.input as unknown as FakeNode);
    expect(after).toHaveLength(before.length);
    after.forEach((node, i) => expect(node).toBe(before[i]));
  });

  it('ships a makeup gain near unity, now the ceiling adds no lift for it to offset (KTD8)', () => {
    // The derivation is beside DEFAULT_EFFECTS: the EQ and room land within about 0.7 dB of the plain sound.
    expect(Math.abs(DEFAULT_EFFECTS.makeupDb)).toBeLessThanOrEqual(1);
  });
});

describe('installLiveEffects', () => {
  function apiWith(context: unknown) {
    return { _player: { _instance: { _output: { context } } } };
  }

  it('points alphaTab at the effects, ends at the real speakers, and can be taken out again', () => {
    const ctx = new FakeContext();
    const real = ctx.destination;
    const { remove } = installLiveEffects(apiWith(ctx));
    const entry = ctx.destination as FakeNode;
    expect(entry).not.toBe(real);
    // Whatever alphaTab connects to `destination` now meets the effects, and the signal ends at the real destination.
    expect(walk(entry)).toContain(real);
    remove();
    expect(ctx.destination).toBe(real);
    expect(walk(entry).includes(real)).toBe(false);
  });

  it('hands back a switch that flips the installed chain live, and the node the speakers hear', () => {
    const ctx = new FakeContext();
    const real = ctx.destination;
    const effects = installLiveEffects(apiWith(ctx), false);
    const entry = ctx.destination as FakeNode;
    const output = effects.output as unknown as FakeNode;
    expect(output.connections).toContain(real);
    const plain = entry.connections.find((n) => n.kind === 'gain' && n.connections.includes(output));
    expect(plain?.gain.value).toBe(1);
    effects.setEnabled(true);
    expect(plain?.gain.target()).toEqual({ kind: 'ramp', value: 0, time: ctx.currentTime + CROSSFADE_SECONDS });
    // The switch does not reinstall: alphaTab still meets the same entry.
    expect(ctx.destination).toBe(entry);
  });

  it('leaves playback alone when alphaTab is not shaped as expected', () => {
    for (const api of [{}, { _player: {} }, apiWith(null), apiWith(undefined)]) {
      const effects = installLiveEffects(api);
      expect(() => effects.setEnabled(false)).not.toThrow();
      expect(() => effects.remove()).not.toThrow();
      expect(effects.output).toBeNull();
    }
  });
});

describe('renderWithEffects', () => {
  it('hands back the audio unchanged where offline audio is not available', async () => {
    const pcm = { left: new Float32Array([0.1, 0.2]), right: new Float32Array([0.3, 0.4]), sampleRate: 48000 };
    expect(await renderWithEffects(pcm)).toBe(pcm);
  });

  it('hands back the plain audio when the browser cannot render with effects', async () => {
    vi.stubGlobal(
      'OfflineAudioContext',
      class {
        constructor() {
          throw new Error('out of memory');
        }
      },
    );
    try {
      const pcm = { left: new Float32Array([0.1, 0.2]), right: new Float32Array([0.3, 0.4]), sampleRate: 48000 };
      expect(await renderWithEffects(pcm)).toBe(pcm);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('hands back empty audio as it is', async () => {
    const pcm = { left: new Float32Array(0), right: new Float32Array(0), sampleRate: 48000 };
    expect(await renderWithEffects(pcm)).toBe(pcm);
  });
});
