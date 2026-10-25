import { describe, expect, it } from 'vitest';
import { recordLocks } from '../../src/app/record-locks';

describe('recordLocks', () => {
  it('covers AE4: locks source switching and file loads while a recording is picking, checking or running, with a reason', () => {
    for (const state of [{ name: 'picking' }, { name: 'checking' }, { name: 'recording' }] as const) {
      const locks = recordLocks(state);
      expect(locks.locked).toBe(true);
      expect(locks.reason).toMatch(/recording/i);
    }
  });

  it('keeps the lock while a warning waits for Record anyway, because the recording starts from it', () => {
    expect(recordLocks({ name: 'report', variant: 'before-recording' }).locked).toBe(true);
  });

  it('locks nothing once the recording is saving, done, failed or idle', () => {
    for (const state of [{ name: 'idle' }, { name: 'saving' }, { name: 'done' }, { name: 'failed' }] as const) {
      expect(recordLocks(state)).toEqual({ locked: false, reason: null });
    }
  });

  it('locks nothing after a Re-check, which never records', () => {
    expect(recordLocks({ name: 'report', variant: 'check-only' })).toEqual({ locked: false, reason: null });
  });
});
