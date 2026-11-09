import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_SAVE_CAP_MS, createCloseHandler, type CloseSteps } from '../../src/app/window-close';

function steps(overrides: Partial<CloseSteps> = {}) {
  const order: string[] = [];
  const all: CloseSteps = {
    park: vi.fn(() => void order.push('park')),
    flush: vi.fn(() => void order.push('flush')),
    settled: vi.fn(() => {
      order.push('settled');
      return Promise.resolve();
    }),
    ready: vi.fn(() => {
      order.push('ready');
      return Promise.resolve();
    }),
    ...overrides,
  };
  return { all, order };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createCloseHandler', () => {
  it('parks, flushes the profile, waits for the song to settle, then tells the shell it is ready', async () => {
    const { all, order } = steps();
    await createCloseHandler(all)();
    expect(order).toEqual(['park', 'flush', 'settled', 'ready']);
  });

  it('tells the shell only after the save has resolved', async () => {
    let finish = () => undefined as void;
    const { all } = steps({ settled: () => new Promise<void>((resolve) => (finish = resolve)) });
    const done = createCloseHandler(all)();
    await Promise.resolve();
    expect(all.ready).not.toHaveBeenCalled();
    finish();
    await done;
    expect(all.ready).toHaveBeenCalledTimes(1);
  });

  it('tells the shell once the cap passes when the save takes too long', async () => {
    vi.useFakeTimers();
    const { all } = steps({ settled: () => new Promise<void>(() => undefined) });
    const done = createCloseHandler(all)();
    await vi.advanceTimersByTimeAsync(CLOSE_SAVE_CAP_MS - 1);
    expect(all.ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(all.ready).toHaveBeenCalledTimes(1);
  });

  it('still flushes, waits and tells the shell when parking throws', async () => {
    const { all, order } = steps({
      park: () => {
        throw new Error('no clock');
      },
    });
    await createCloseHandler(all)();
    expect(order).toEqual(['flush', 'settled', 'ready']);
  });

  it('still tells the shell when the flush throws or the save rejects', async () => {
    const { all } = steps({
      flush: () => {
        throw new Error('flush failed');
      },
      settled: () => Promise.reject(new Error('save failed')),
    });
    await createCloseHandler(all)();
    expect(all.ready).toHaveBeenCalledTimes(1);
  });

  it('does not reject when telling the shell fails', async () => {
    const { all } = steps({ ready: () => Promise.reject(new Error('gone')) });
    await expect(createCloseHandler(all)()).resolves.toBeUndefined();
  });

  it('runs once for repeated close requests while one is in flight', async () => {
    let finish = () => undefined as void;
    const { all } = steps({ settled: () => new Promise<void>((resolve) => (finish = resolve)) });
    const close = createCloseHandler(all);
    const first = close();
    const second = close();
    finish();
    await Promise.all([first, second]);
    expect(all.park).toHaveBeenCalledTimes(1);
    expect(all.ready).toHaveBeenCalledTimes(1);
  });
});
