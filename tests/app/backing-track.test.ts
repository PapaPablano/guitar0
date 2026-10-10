import { describe, expect, it } from 'vitest';
import { chooseMethod, methodsFor } from '../../src/app/backing-track';
import { describeEngine, type ShellEngineStatus } from '../../src/app/engine-state';

const engine = (phase: ShellEngineStatus['phase']) => describeEngine({ phase, url: 'u', secret: 's' } as ShellEngineStatus);

describe('methodsFor', () => {
  it('covers AE5: offers only loading a file on the website', () => {
    expect(methodsFor({ desktop: false, youtube: true })).toEqual(['file']);
  });

  it('offers only loading a file when the YouTube option is off, even on desktop', () => {
    expect(methodsFor({ desktop: true, youtube: false })).toEqual(['file']);
  });

  it('offers both on a desktop build with the YouTube option on', () => {
    expect(methodsFor({ desktop: true, youtube: true })).toEqual(['file', 'youtube']);
  });
});

describe('chooseMethod', () => {
  it('covers AE1: choosing YouTube before setup has run starts setup', () => {
    expect(chooseMethod('youtube', engine('setup-needed'))).toEqual({ method: 'youtube', startSetup: true });
  });

  it('does not start setup again while it runs, or after it failed, or when the engine is ready', () => {
    for (const phase of ['setting-up', 'starting', 'setup-failed', 'restarting', 'engine-error', 'ready'] as const) {
      expect(chooseMethod('youtube', engine(phase)).startSetup).toBe(false);
    }
  });

  it('never starts setup for loading a file', () => {
    expect(chooseMethod('file', engine('setup-needed'))).toEqual({ method: 'file', startSetup: false });
  });
});
