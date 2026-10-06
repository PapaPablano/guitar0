import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClickCountIn, clickTimes, type ClickAudio } from '../../src/audio/count-in';

function fakeContext(over: { failResume?: boolean } = {}) {
  const oscillators: { frequency: { value: number }; started: number[]; stopped: number[] }[] = [];
  const context: ClickAudio & { oscillators: typeof oscillators } = {
    currentTime: 2,
    destination: {},
    oscillators,
    createOscillator() {
      const osc = { frequency: { value: 0 }, started: [] as number[], stopped: [] as number[], connect() {}, start(at: number) { osc.started.push(at); }, stop(at: number) { osc.stopped.push(at); } };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    },
    async resume() {
      if (over.failResume) throw new Error('blocked');
    },
  };
  return context;
}

describe('clickTimes', () => {
  it('puts a click on each beat, one beat apart, after a short lead', () => {
    const times = clickTimes(4, 120, 10);
    expect(times).toHaveLength(4);
    expect(times[1] - times[0]).toBeCloseTo(0.5, 9);
    expect(times[3] - times[0]).toBeCloseTo(1.5, 9);
    expect(times[0]).toBeGreaterThan(10);
  });

  it('keeps a tempo that is not a tempo, or is out of reach, in a range a player can follow', () => {
    expect(clickTimes(2, Number.NaN, 0)[1] - clickTimes(2, Number.NaN, 0)[0]).toBeCloseTo(0.5, 9);
    expect(clickTimes(2, 5, 0)[1] - clickTimes(2, 5, 0)[0]).toBeCloseTo(2, 9);
    expect(clickTimes(2, 9000, 0)[1] - clickTimes(2, 9000, 0)[0]).toBeCloseTo(0.2, 9);
  });
});

describe('ClickCountIn', () => {
  afterEach(() => vi.useRealTimers());

  it('plays one click per beat, the first higher, and resolves true once the beats have gone by', async () => {
    vi.useFakeTimers();
    const context = fakeContext();
    const countIn = new ClickCountIn(() => context);
    const done = vi.fn();
    void countIn.play(4, 120).then(done);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.oscillators).toHaveLength(4);
    expect(context.oscillators[0].frequency.value).toBeGreaterThan(context.oscillators[1].frequency.value);
    expect(context.oscillators[1].started[0]).toBeCloseTo(2 + 0.05 + 0.5, 9);
    await vi.advanceTimersByTimeAsync(1900);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toHaveBeenCalledWith(true);
  });

  it('cancelling stops the clicks and resolves false', async () => {
    vi.useFakeTimers();
    const context = fakeContext();
    const countIn = new ClickCountIn(() => context);
    const done = vi.fn();
    void countIn.play(4, 120).then(done);
    await vi.advanceTimersByTimeAsync(0);
    countIn.cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledWith(false);
    expect(context.oscillators.every((o) => o.stopped.includes(0))).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('a new count-in replaces one in progress', async () => {
    vi.useFakeTimers();
    const countIn = new ClickCountIn(() => fakeContext());
    const first = vi.fn();
    const second = vi.fn();
    void countIn.play(4, 120).then(first);
    await vi.advanceTimersByTimeAsync(0);
    void countIn.play(4, 120).then(second);
    await vi.advanceTimersByTimeAsync(2200);
    expect(first).toHaveBeenCalledWith(false);
    expect(second).toHaveBeenCalledWith(true);
  });

  it('still keeps the wait when there is no sound to count with', async () => {
    vi.useFakeTimers();
    const countIn = new ClickCountIn(() => fakeContext({ failResume: true }));
    const done = vi.fn();
    void countIn.play(4, 120).then(done);
    await vi.advanceTimersByTimeAsync(1900);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toHaveBeenCalledWith(true);
  });

  it('a count-in cancelled while its audio is still resuming never starts, and resolves false', async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const context = fakeContext();
    context.resume = () => new Promise<void>((resolve) => (release = resolve));
    const countIn = new ClickCountIn(() => context);
    const done = vi.fn();
    void countIn.play(4, 120).then(done);
    await vi.advanceTimersByTimeAsync(0);
    countIn.cancel();
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith(false);
    expect(context.oscillators).toHaveLength(0);
  });

  it('a newer count-in started while an older one is resuming is the only one that plays', async () => {
    vi.useFakeTimers();
    const releases: (() => void)[] = [];
    const context = fakeContext();
    context.resume = () => new Promise<void>((resolve) => releases.push(resolve));
    const countIn = new ClickCountIn(() => context);
    const first = vi.fn();
    const second = vi.fn();
    void countIn.play(4, 120).then(first);
    await vi.advanceTimersByTimeAsync(0);
    void countIn.play(4, 120).then(second);
    await vi.advanceTimersByTimeAsync(0);
    releases.forEach((release) => release());
    await vi.advanceTimersByTimeAsync(3000);
    expect(first).toHaveBeenCalledWith(false);
    expect(second).toHaveBeenCalledWith(true);
    expect(context.oscillators).toHaveLength(4);
  });

  it('cancelling with nothing playing does nothing', () => {
    expect(() => new ClickCountIn(() => fakeContext()).cancel()).not.toThrow();
  });
});
