import { describe, expect, it, vi } from 'vitest';
import { PROFILE_VERSION, type ProfileStore, type RecordingProfile } from '../../src/audio/recording-profile';
import { initialMix } from '../../src/audio/mix-gains';
import { createDebouncer, decideRestore, fetchProfile, DEBOUNCE_MS } from '../../src/app/restore-profile';

const profile = (offset: number, withMix = false): RecordingProfile => {
  const mix = initialMix();
  mix.guitar.muted = true;
  return withMix ? { version: PROFILE_VERSION, offset, mix } : { version: PROFILE_VERSION, offset };
};
const storeOf = (p: RecordingProfile | null): ProfileStore => ({ load: async () => p, save: async () => undefined });

describe('fetchProfile', () => {
  it('returns the hash and the stored profile for known bytes (AE8)', async () => {
    const r = await fetchProfile(async () => 'h1', storeOf(profile(-1.5)));
    expect(r).toEqual({ hash: 'h1', profile: profile(-1.5) });
  });
  it('returns no profile for different bytes (AE8)', async () => {
    const store: ProfileStore = { load: async (h) => (h === 'h1' ? profile(2) : null), save: async () => undefined };
    expect((await fetchProfile(async () => 'h2', store)).profile).toBeNull();
  });
  it('a store that rejects yields no profile but keeps the hash (R20)', async () => {
    const store: ProfileStore = { load: () => Promise.reject(new Error('x')), save: async () => undefined };
    expect(await fetchProfile(async () => 'h', store)).toEqual({ hash: 'h', profile: null });
  });
  it('a hash that rejects yields no hash, no profile, and never touches the store', async () => {
    const load = vi.fn();
    const r = await fetchProfile(() => Promise.reject(new Error('no crypto')), { load, save: async () => undefined });
    expect(r).toEqual({ hash: null, profile: null });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('decideRestore', () => {
  const ok = { stillLoaded: true, offsetMoved: false, desktop: false };
  it('applies the offset when nothing changed', () => {
    expect(decideRestore(ok, profile(-2))).toEqual({ offset: -2 });
  });
  it('restores only offset and mix; loop and tempo have no place in the plan (AE9)', () => {
    expect(Object.keys(decideRestore({ ...ok, desktop: true }, profile(1, true))!).sort()).toEqual(['mix', 'offset']);
  });
  it('discards when the user moved the offset first', () => {
    expect(decideRestore({ ...ok, offsetMoved: true }, profile(3))).toBeNull();
  });
  it('discards when another recording is now loaded', () => {
    expect(decideRestore({ ...ok, stillLoaded: false }, profile(3))).toBeNull();
  });
  it('discards when there is no profile', () => {
    expect(decideRestore(ok, null)).toBeNull();
  });
  it('applies the mix on desktop only', () => {
    expect(decideRestore({ ...ok, desktop: true }, profile(1, true))?.mix).toBeDefined();
    expect(decideRestore(ok, profile(1, true))?.mix).toBeUndefined();
  });
});

describe('createDebouncer', () => {
  function fakeTimers() {
    let next = 1;
    const pending = new Map<number, () => void>();
    return {
      setTimeout: (fn: () => void) => {
        pending.set(next, fn);
        return next++;
      },
      clearTimeout: (id: number) => void pending.delete(id),
      runAll: () => [...pending.values()].forEach((fn) => fn()) ?? pending.clear(),
      size: () => pending.size,
    };
  }
  it('ten pushes inside the window produce one fire with the last value', () => {
    const t = fakeTimers();
    const fired: number[] = [];
    const d = createDebouncer<number>(DEBOUNCE_MS, (v) => fired.push(v), t);
    for (let i = 1; i <= 10; i++) d.push(i);
    expect(t.size()).toBe(1);
    t.runAll();
    expect(fired).toEqual([10]);
  });
  it('flush fires a pending value immediately, once', () => {
    const t = fakeTimers();
    const fired: string[] = [];
    const d = createDebouncer<string>(500, (v) => fired.push(v), t);
    d.push('a');
    d.flush();
    d.flush();
    t.runAll();
    expect(fired).toEqual(['a']);
  });
  it('cancel drops a pending value', () => {
    const t = fakeTimers();
    const fired: number[] = [];
    const d = createDebouncer<number>(500, (v) => fired.push(v), t);
    d.push(1);
    d.cancel();
    t.runAll();
    expect(fired).toEqual([]);
  });
});
