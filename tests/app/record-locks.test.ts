import { describe, expect, it } from 'vitest';
import { recordBusyReason, recordLocks } from '../../src/app/record-locks';

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

describe('recordBusyReason', () => {
  it('says a recording or check is running while picking, checking, recording or saving', () => {
    for (const state of [{ name: 'picking' }, { name: 'checking' }, { name: 'recording' }, { name: 'saving' }] as const) {
      expect(recordBusyReason(state)).toMatch(/already running/i);
    }
  });

  it('lets Record start again from idle, done, failed and any report, since a new start replaces a report', () => {
    for (const state of [{ name: 'idle' }, { name: 'done' }, { name: 'failed' }, { name: 'report', variant: 'check-only' }, { name: 'report', variant: 'before-recording' }] as const) {
      expect(recordBusyReason(state)).toBeNull();
    }
  });
});
