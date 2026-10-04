import { describe, expect, it } from 'vitest';
import { describeEngine, readEngineStatus, setupBar, startEngineSetup, type ShellEngineStatus } from '../../src/app/engine-state';

const status = (s: Partial<ShellEngineStatus> & { phase: ShellEngineStatus['phase'] }): ShellEngineStatus => s as ShellEngineStatus;

describe('describeEngine', () => {
  it('shows nothing stem-related on the web', () => {
    expect(describeEngine(null)).toEqual({ kind: 'web', stemsEnabled: false, canRetry: false, busy: false, message: '', progress: null });
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

  it('covers AE11: a restarting engine is its own view, neither a stuck spinner nor a failure', () => {
    const d = describeEngine(status({ phase: 'restarting', message: 'The stem engine stopped; restarting it' }));
    expect(d.kind).toBe('restarting');
    expect(d.stemsEnabled).toBe(false);
    expect(d.canRetry).toBe(false);
    expect(d.progress).toBeNull();
    expect(d.message).toContain('restarting');
  });

  it('has a default message when restarting without one', () => {
    expect(describeEngine(status({ phase: 'restarting' })).message).toMatch(/restart/i);
  });

  it('keeps the log tail in the message when the engine fails again', () => {
    const d = describeEngine(status({ phase: 'engine-error', message: 'The engine exited (code 1).\nImportError: no module named torch' }));
    expect(d.kind).toBe('blocked');
    expect(d.canRetry).toBe(true);
    expect(d.message).toContain('ImportError: no module named torch');
  });

  it('clamps progress to 0..1', () => {
    expect(describeEngine(status({ phase: 'setting-up', progress: 3 })).progress).toBe(1);
    expect(describeEngine(status({ phase: 'setting-up', progress: -1 })).progress).toBe(0);
  });
});

describe('setupBar (R21, AE12)', () => {
  it('is an indeterminate bar while setting up without a known progress', () => {
    expect(setupBar(describeEngine(status({ phase: 'setting-up', progress: null as unknown as undefined })))).toEqual({ kind: 'indeterminate' });
  });

  it('is a determinate bar once progress is known, and rises with it', () => {
    expect(setupBar(describeEngine(status({ phase: 'setting-up', progress: 0.5 })))).toEqual({ kind: 'determinate', value: 0.5 });
    const later = setupBar(describeEngine(status({ phase: 'setting-up', progress: 0.7 })));
    expect(later).toEqual({ kind: 'determinate', value: 0.7 });
  });

  it('shows no bar on the web, when failed, when needed, or when ready', () => {
    for (const s of [null, status({ phase: 'setup-failed', message: 'x' }), status({ phase: 'setup-needed' }), status({ phase: 'ready' })]) {
      expect(setupBar(describeEngine(s))).toEqual({ kind: 'none' });
    }
  });
});

describe('R25: setup never blocks practice', () => {
  it('only the stem controls depend on the engine: they are enabled in the ready phase and nowhere else', () => {
    const phases: ShellEngineStatus['phase'][] = ['setup-needed', 'setting-up', 'setup-failed', 'starting', 'restarting', 'ready', 'engine-error'];
    for (const phase of phases) {
      const view = describeEngine(status({ phase }));
      expect(view.stemsEnabled).toBe(phase === 'ready');
    }
  });

  it('reads the shell status and starts setup through promises, so the page never waits on setup', async () => {
    const read = readEngineStatus();
    const start = startEngineSetup();
    expect(read).toBeInstanceOf(Promise);
    expect(start).toBeInstanceOf(Promise);
    await Promise.allSettled([read, start]); // no shell in Node: both reject, neither throws synchronously
  });
});
