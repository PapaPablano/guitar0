import { describe, expect, it, vi } from 'vitest';
import {
  buildEffects,
  DEFAULT_EFFECTS,
  installLiveEffects,
  renderWithEffects,
  roomImpulse,
  softClipCurve,
} from '../../src/audio/synth-effects';

/** A stand-in audio node that records its kind, settings and connections. */
class FakeNode {
  connections: FakeNode[] = [];
  gain = { value: 1 };
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
    expect(chain.output).toBe(nodes.find((n) => n.kind === 'shaper'));
    expect((chain.output as unknown as FakeNode).oversample).toBe('2x');
  });

  it('mixes the dry and room signals so they add up to the whole', () => {
    const nodes = walk(buildEffects(asContext(new FakeContext())).input as unknown as FakeNode);
    const gains = nodes.filter((n) => n.kind === 'gain').map((n) => n.gain.value);
    expect(gains).toContain(1 - DEFAULT_EFFECTS.roomMix);
    expect(gains).toContain(DEFAULT_EFFECTS.roomMix);
  });

  it('is a plain pass-through when switched off', () => {
    const chain = buildEffects(asContext(new FakeContext()), false);
    expect(chain.input).toBe(chain.output);
    expect(walk(chain.input as unknown as FakeNode).map((n) => n.kind)).toEqual(['gain']);
    expect((chain.input as unknown as FakeNode).gain.value).toBe(1);
  });
});

describe('installLiveEffects', () => {
  function apiWith(context: unknown) {
    return { _player: { _instance: { _output: { context } } } };
  }

  it('points alphaTab at the effects, ends at the real speakers, and can be taken out again', () => {
    const ctx = new FakeContext();
    const real = ctx.destination;
    const remove = installLiveEffects(apiWith(ctx));
    const entry = ctx.destination as FakeNode;
    expect(entry).not.toBe(real);
    // Whatever alphaTab connects to `destination` now meets the effects, and the signal ends at the real destination.
    expect(walk(entry)).toContain(real);
    remove();
    expect(ctx.destination).toBe(real);
    expect(walk(entry).includes(real)).toBe(false);
  });

  it('leaves playback alone when alphaTab is not shaped as expected', () => {
    for (const api of [{}, { _player: {} }, apiWith(null), apiWith(undefined)]) {
      expect(() => installLiveEffects(api)()).not.toThrow();
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
