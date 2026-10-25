import { describe, expect, it } from 'vitest';
import { buildTestSignal } from '../../src/audio/capture-test-tone';
import { analyseCapture, describeEffects } from '../../src/export/capture-check';

const RATE = 48000;

/** One-pole lowpass applied several times: a steep fall above the cutoff, standing in for a codec or voice-call filter. */
function lowpassed(samples: Float32Array, cutoffHz: number, passes = 4): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / RATE);
  let out = samples;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(out.length);
    let y = 0;
    for (let i = 0; i < out.length; i++) {
      y += a * (out[i] - y);
      next[i] = y;
    }
    out = next;
  }
  return out;
}

function scaled(samples: Float32Array, gain: number): Float32Array {
  return samples.map((s) => s * gain);
}

function delayed(samples: Float32Array, seconds: number): Float32Array {
  const lead = Math.round(seconds * RATE);
  const out = new Float32Array(samples.length + lead);
  out.set(samples, lead);
  return out;
}

/** Applies a gain to each stretch of the signal given as [startSeconds, endSeconds, gain]. */
function gainedWindows(samples: Float32Array, windows: Array<[number, number, number]>): Float32Array {
  const out = samples.slice();
  for (const [from, to, gain] of windows) {
    for (let i = Math.floor(from * RATE); i < Math.min(out.length, Math.floor(to * RATE)); i++) out[i] *= gain;
  }
  return out;
}

describe('the capture check signal', () => {
  const signal = buildTestSignal(RATE);

  it('is a few seconds long and stays at a moderate level', () => {
    expect(signal.samples.length / RATE).toBeGreaterThan(2);
    expect(signal.samples.length / RATE).toBeLessThan(6);
    const peak = signal.samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(peak).toBeLessThanOrEqual(0.5);
    expect(peak).toBeGreaterThan(0.2);
  });

  it('has bursts at stepped levels, not one steady tone', () => {
    const amplitudes = signal.bursts.map((b) => b.amplitude);
    expect(signal.bursts.length).toBeGreaterThanOrEqual(5);
    expect(new Set(amplitudes).size).toBeGreaterThanOrEqual(3);
  });

  it('is the same every time', () => {
    expect(buildTestSignal(RATE).samples).toEqual(signal.samples);
  });
});

describe('analyseCapture', () => {
  const signal = buildTestSignal(RATE);

  it('finds nothing wrong with a capture identical to what was played', () => {
    const report = analyseCapture(signal, signal.samples, RATE);
    expect(report.verdict).toBe('clean');
    expect(report.effects).toEqual([]);
  });

  it('aligns a capture that arrives late before comparing, so latency is not read as loss', () => {
    const report = analyseCapture(signal, delayed(signal.samples, 0.3), RATE);
    expect(report.verdict).toBe('clean');
    expect(report.latencySeconds).toBeCloseTo(0.3, 2);
  });

  it('reports lost highs, with the fall in dB, for a copy lowpassed near 3 kHz', () => {
    const report = analyseCapture(signal, lowpassed(signal.samples, 3000), RATE);
    const highs = report.effects.find((e) => e.kind === 'lost-highs');
    expect(report.verdict).toBe('altered');
    expect(highs).toBeDefined();
    expect(highs!.measured).toBeLessThan(-6);
  });

  it('covers R3: reports a level change with the number for a copy that is 6 dB down', () => {
    const report = analyseCapture(signal, scaled(signal.samples, 0.5), RATE);
    const level = report.effects.find((e) => e.kind === 'level-change');
    expect(level).toBeDefined();
    expect(level!.measured).toBeCloseTo(-6, 0);
  });

  it('reports automatic gain when every burst comes back at nearly the same level', () => {
    // Each burst is pulled to the level of the loudest, as an automatic gain stage would.
    const target = Math.max(...signal.bursts.map((b) => b.amplitude));
    const evened = gainedWindows(
      signal.samples,
      signal.bursts.map((b): [number, number, number] => [b.start, b.end, target / b.amplitude]),
    );
    const report = analyseCapture(signal, evened, RATE);
    expect(report.effects.map((e) => e.kind)).toContain('automatic-gain');
  });

  it('reports gating when the later bursts are removed', () => {
    const late = signal.bursts.slice(-2);
    const gated = gainedWindows(
      signal.samples,
      late.map((b): [number, number, number] => [b.start - 0.01, b.end + 0.01, 0]),
    );
    const report = analyseCapture(signal, gated, RATE);
    expect(report.effects.map((e) => e.kind)).toContain('gating');
  });

  it('says nothing was captured, and does not pass it, for an all-zero capture', () => {
    const report = analyseCapture(signal, new Float32Array(signal.samples.length), RATE);
    expect(report.verdict).toBe('nothing');
    expect(report.effects.map((e) => e.kind)).toEqual(['nothing-captured']);
  });

  it('resamples a capture made at another rate before comparing', () => {
    const half = new Float32Array(Math.floor(signal.samples.length / 2));
    for (let i = 0; i < half.length; i++) half[i] = signal.samples[i * 2];
    const report = analyseCapture(signal, half, RATE / 2);
    expect(report.verdict).not.toBe('nothing');
  });
});

describe('describeEffects', () => {
  const signal = buildTestSignal(RATE);

  it('puts each effect in plain words with its number', () => {
    const lines = describeEffects(analyseCapture(signal, lowpassed(scaled(signal.samples, 0.5), 3000), RATE));
    expect(lines.some((l) => /highs/i.test(l) && /dB/.test(l))).toBe(true);
    expect(lines.some((l) => /quieter|level/i.test(l))).toBe(true);
  });

  it('says the sound came through unchanged when there is no effect', () => {
    expect(describeEffects(analyseCapture(signal, signal.samples, RATE))[0]).toMatch(/unchanged|came through/i);
  });
});
