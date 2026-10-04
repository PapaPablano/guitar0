import { describe, expect, it } from 'vitest';
import { createRunGuard } from '../../src/stems/run-guard';

describe('createRunGuard', () => {
  it('treats the latest run as current', () => {
    const guard = createRunGuard();
    const a = guard.begin();
    expect(guard.isCurrent(a)).toBe(true);
  });

  it('makes an earlier run stale when a new one begins', () => {
    const guard = createRunGuard();
    const a = guard.begin();
    const b = guard.begin();
    expect(guard.isCurrent(a)).toBe(false);
    expect(guard.isCurrent(b)).toBe(true);
  });

  it('makes the running run stale when invalidated, as when the song or recording changes', () => {
    const guard = createRunGuard();
    const a = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(a)).toBe(false);
    expect(guard.isCurrent(guard.begin())).toBe(true);
  });
});
