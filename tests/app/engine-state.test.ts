import { describe, expect, it } from 'vitest';
import { describeEngine, type ShellEngineStatus } from '../../src/app/engine-state';

const status = (s: Partial<ShellEngineStatus> & { phase: ShellEngineStatus['phase'] }): ShellEngineStatus => s as ShellEngineStatus;

describe('describeEngine', () => {
  it('shows nothing stem-related on the web', () => {
    expect(describeEngine(null)).toEqual({ kind: 'web', stemsEnabled: false, canRetry: false, message: '', progress: null });
  });

  it('covers AE1: setup unfinished disables stems with an explanation and a retry', () => {
    const d = describeEngine(status({ phase: 'setup-failed', message: 'No network' }));
    expect(d.kind).toBe('setup');
    expect(d.stemsEnabled).toBe(false);
    expect(d.canRetry).toBe(true);
    expect(d.message).toContain('No network');
  });

  it('shows progress while setting up, without a retry', () => {
    const d = describeEngine(status({ phase: 'setting-up', progress: 0.4, message: 'Downloading the model' }));
    expect(d.kind).toBe('setup');
    expect(d.progress).toBeCloseTo(0.4, 9);
    expect(d.canRetry).toBe(false);
    expect(d.stemsEnabled).toBe(false);
  });

  it('offers to start setup on first launch', () => {
    const d = describeEngine(status({ phase: 'setup-needed' }));
    expect(d.kind).toBe('setup');
    expect(d.canRetry).toBe(true);
  });

  it('enables stems when the engine is ready', () => {
    const d = describeEngine(status({ phase: 'ready', url: 'http://127.0.0.1:5000', secret: 's' }));
    expect(d.kind).toBe('ready');
    expect(d.stemsEnabled).toBe(true);
  });

  it('reports a stopped engine with a restart instead of a stuck spinner', () => {
    const d = describeEngine(status({ phase: 'engine-error', message: 'exited' }));
    expect(d.kind).toBe('blocked');
    expect(d.canRetry).toBe(true);
    expect(d.stemsEnabled).toBe(false);
  });

  it('clamps progress to 0..1', () => {
    expect(describeEngine(status({ phase: 'setting-up', progress: 3 })).progress).toBe(1);
    expect(describeEngine(status({ phase: 'setting-up', progress: -1 })).progress).toBe(0);
  });
});
