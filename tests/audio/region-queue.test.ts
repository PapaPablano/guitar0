import { describe, expect, it } from 'vitest';
import { orderChunks, RegionQueue, type RegionSource } from '../../src/audio/region-queue';
import type { ChunkState } from '../../src/audio/recording-pcm';

const wants = (over: Partial<Parameters<typeof orderChunks>[0]> = {}) => ({ chunkCount: 24, chunkSeconds: 10, target: null, playhead: 0, loop: null, ...over });

describe('orderChunks', () => {
  it('starts at the playhead, then the stretch just ahead, then the rest onward and back', () => {
    const { needed, rest } = orderChunks(wants({ playhead: 125 }));
    expect(needed).toEqual([12, 13, 14, 15]);
    expect(rest.slice(0, 3)).toEqual([16, 17, 18]);
    expect(rest.slice(-3)).toEqual([2, 1, 0]);
    expect(new Set([...needed, ...rest]).size).toBe(24);
  });

  it('puts a jump target and the chunk after it before everything else', () => {
    const { needed } = orderChunks(wants({ playhead: 12, target: 130 }));
    expect(needed.slice(0, 3)).toEqual([13, 14, 1]);
  });

  it('wants the whole loop, after the playhead', () => {
    const { needed } = orderChunks(wants({ playhead: 5, loop: { start: 82, end: 107 } }));
    expect(needed).toEqual(expect.arrayContaining([8, 9, 10]));
    expect(needed.indexOf(0)).toBeLessThan(needed.indexOf(8));
  });

  it('stays within the recording at both ends', () => {
    const end = orderChunks(wants({ playhead: 239 }));
    expect(end.needed).toEqual([23]);
    const start = orderChunks(wants({ playhead: 0, target: 1e9 }));
    expect(Math.max(...start.needed, ...start.rest)).toBe(23);
    expect(Math.min(...start.needed, ...start.rest)).toBe(0);
  });
});

/** A store that decodes a chunk after a tick and records the order, with a settable budget. */
function fakeSource(count: number, capacity = count) {
  const states: ChunkState[] = new Array(count).fill('not-yet');
  const log: number[] = [];
  const listeners = new Set<() => void>();
  const inFlight = new Map<number, Promise<void>>();
  let focus: number[] = [];
  const source: RegionSource & { log: number[]; focus: () => number[]; failing: Set<number> } = {
    chunkCount: count,
    chunkSeconds: 10,
    capacityChunks: capacity,
    get exactCount() {
      return states.filter((s) => s === 'exact').length;
    },
    log,
    failing: new Set<number>(),
    chunkState: (i) => states[i],
    focus: () => focus,
    setFocus: (indices) => {
      focus = Array.from(indices);
    },
    onChange: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ensure(i) {
      const running = inFlight.get(i);
      if (running) return running;
      if (states[i] !== 'not-yet') return Promise.resolve();
      states[i] = 'getting';
      const done = new Promise<void>((resolve) =>
        setTimeout(() => {
          log.push(i);
          states[i] = source.failing.has(i) ? 'failed' : 'exact';
          listeners.forEach((l) => l());
          resolve();
        }, 1),
      );
      inFlight.set(i, done);
      return done;
    },
  };
  return source;
}

const settle = () => new Promise((r) => setTimeout(r, 600));

describe('RegionQueue', () => {
  it('fills from the playhead outward: ahead first, then the rest', async () => {
    const source = fakeSource(8);
    const queue = new RegionQueue(source);
    queue.setPlayhead(35);
    await settle();
    expect(source.log.slice(0, 4)).toEqual([0, 3, 4, 5]); // 0 began before the playhead moved
    expect(source.log.slice(4)).toEqual(expect.arrayContaining([6, 7, 2, 1]));
    expect(source.log).toHaveLength(8);
    queue.stop();
  });

  it('a jump goes to the front of what is left, and resolves once its chunks are exact', async () => {
    const source = fakeSource(20);
    const queue = new RegionQueue(source);
    queue.setPlayhead(5);
    const ready = await queue.request(150);
    expect(ready).toBe(true);
    expect(source.log).toEqual(expect.arrayContaining([15, 16]));
    // chunks right behind the playhead were not waited for
    expect(source.log.indexOf(1) === -1 || source.log.indexOf(15) < source.log.indexOf(1)).toBe(true);
    queue.stop();
  });

  it('says false when a chunk of the jump failed to decode', async () => {
    const source = fakeSource(10);
    source.failing.add(6);
    const queue = new RegionQueue(source);
    expect(await queue.request(60)).toBe(false);
    queue.stop();
  });

  it('keeps the chunks being used out of release by focusing them', async () => {
    const source = fakeSource(10);
    const queue = new RegionQueue(source);
    queue.setPlayhead(42);
    queue.setLoop({ start: 80, end: 95 });
    expect(source.focus()).toEqual(expect.arrayContaining([4, 5, 6, 7, 8, 9]));
    queue.stop();
  });

  it('only fills beyond what is needed while the store has room', async () => {
    const source = fakeSource(30, 6);
    const queue = new RegionQueue(source);
    queue.setPlayhead(0);
    await settle();
    // the playhead chunk and the lookahead are needed (4 chunks); the rest fills only to the budget of 6
    expect(source.exactCount).toBe(6);
    expect(source.log).toHaveLength(6);
    queue.stop();
  });

  it('stops filling when stopped, and leaves what is decoded', async () => {
    const source = fakeSource(20);
    const queue = new RegionQueue(source);
    queue.stop();
    await settle();
    expect(source.log.length).toBeLessThanOrEqual(1);
  });
});
