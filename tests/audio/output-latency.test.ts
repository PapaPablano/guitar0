import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextLatency, readOutputLatency, useLatencyContext } from '../../src/audio/output-latency';

describe('output latency', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds the base and output latency a context reports', () => {
    expect(contextLatency({ baseLatency: 0.01, outputLatency: 0.04 })).toBeCloseTo(0.05, 6);
    expect(contextLatency({})).toBe(0);
    expect(contextLatency({ baseLatency: Number.NaN, outputLatency: -1 })).toBe(0);
  });

  it('reads the playing context live instead of a kept value', () => {
    const context = { state: 'running', baseLatency: 0.01, outputLatency: 0.02 };
    useLatencyContext(context as unknown as AudioContext);
    expect(readOutputLatency()).toBeCloseTo(0.03, 6);
    context.outputLatency = 0.09;
    expect(readOutputLatency()).toBeCloseTo(0.1, 6);
  });

  it('does not take a context that has not started as the answer', () => {
    vi.stubGlobal('AudioContext', class { baseLatency = 0.007; outputLatency = 0; close = async () => {}; });
    useLatencyContext({ state: 'suspended', baseLatency: 0, outputLatency: 0 } as unknown as AudioContext);
    expect(readOutputLatency()).toBeGreaterThanOrEqual(0);
  });
});
