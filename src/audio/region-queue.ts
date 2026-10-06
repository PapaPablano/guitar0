import type { ChunkState } from './recording-pcm';

/** Seconds ahead of the playhead that are kept ready, so playing on never reaches a stretch that is not. */
export const LOOKAHEAD_SECONDS = 30;

/** What the queue needs of the store, so tests pass a fake. */
export interface RegionSource {
  readonly chunkCount: number;
  readonly chunkSeconds: number;
  readonly capacityChunks: number;
  readonly exactCount: number;
  chunkState(index: number): ChunkState;
  ensure(index: number): Promise<void>;
  setFocus(indices: Iterable<number>): void;
  onChange(listener: () => void): () => void;
}

export interface Loop {
  readonly start: number;
  readonly end: number;
}

export interface Wants {
  readonly chunkCount: number;
  readonly chunkSeconds: number;
  /** A stretch the player just jumped to, in seconds, or null. */
  readonly target: number | null;
  readonly playhead: number;
  readonly loop: Loop | null;
}

/**
 * The chunks the player needs, in the order they are needed: the one a jump is heading for and the one after it, the one
 * being played, the loop, the stretch just ahead; then `rest`, everything else, onward from there and then back toward the start.
 */
export function orderChunks(w: Wants): { needed: number[]; rest: number[] } {
  const at = (seconds: number) => Math.min(w.chunkCount - 1, Math.max(0, Math.floor(seconds / w.chunkSeconds)));
  const needed: number[] = [];
  const add = (list: number[], index: number) => {
    if (index >= 0 && index < w.chunkCount && !needed.includes(index) && !list.includes(index)) list.push(index);
  };
  if (w.target !== null) {
    add(needed, at(w.target));
    add(needed, at(w.target) + 1);
  }
  const here = at(w.playhead);
  add(needed, here);
  if (w.loop) for (let i = at(w.loop.start); i <= at(w.loop.end); i++) add(needed, i);
  const ahead = Math.ceil(LOOKAHEAD_SECONDS / w.chunkSeconds);
  for (let i = 1; i <= ahead; i++) add(needed, here + i);
  const rest: number[] = [];
  for (let i = here + ahead + 1; i < w.chunkCount; i++) add(rest, i);
  for (let i = here - 1; i >= 0; i--) add(rest, i);
  return { needed, rest };
}

/**
 * Fills a store in the order the player needs it. It decodes one chunk at a time, re-reading where the player is and where a
 * jump is heading before each, so a new jump goes to the front of what is left. Chunks beyond what is needed are only filled
 * while the store has room, so a recording longer than the budget does not decode and release the same stretches over and over.
 */
export class RegionQueue {
  private target: number | null = null;
  private playhead = 0;
  private loop: Loop | null = null;
  private running = false;
  private stopped = false;
  private readonly off: () => void;

  constructor(private readonly source: RegionSource) {
    this.off = source.onChange(() => this.refocus());
    this.refocus();
    void this.run();
  }

  setPlayhead(seconds: number): void {
    this.playhead = seconds;
    this.refocus();
    void this.run();
  }

  setLoop(loop: Loop | null): void {
    this.loop = loop;
    this.refocus();
    void this.run();
  }

  /**
   * Puts the stretch at `seconds` first and resolves once it and the `count - 1` chunks after it are exact, with true; false
   * when one of them failed. The chunk after a target is wanted too, so playing on from it does not at once reach a gap.
   */
  async request(seconds: number, count = 2): Promise<boolean> {
    this.target = seconds;
    this.refocus();
    void this.run();
    const first = Math.min(this.source.chunkCount - 1, Math.max(0, Math.floor(seconds / this.source.chunkSeconds)));
    let ok = true;
    for (let i = first; i < Math.min(this.source.chunkCount, first + count); i++) {
      await this.source.ensure(i);
      if (this.source.chunkState(i) !== 'exact') ok = false;
    }
    return ok;
  }

  /** Stops filling; what is decoded stays. */
  stop(): void {
    this.stopped = true;
    this.off();
  }

  private wants(): Wants {
    return { chunkCount: this.source.chunkCount, chunkSeconds: this.source.chunkSeconds, target: this.target, playhead: this.playhead, loop: this.loop };
  }

  private refocus(): void {
    this.source.setFocus(orderChunks(this.wants()).needed);
  }

  private next(): number | null {
    const { needed, rest } = orderChunks(this.wants());
    const open = (i: number) => this.source.chunkState(i) === 'not-yet';
    const firstNeeded = needed.find(open);
    if (firstNeeded !== undefined) return firstNeeded;
    if (this.source.exactCount >= this.source.capacityChunks) return null;
    return rest.find(open) ?? null;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let index = this.next(); index !== null && !this.stopped; index = this.next()) {
        await this.source.ensure(index);
        // A chunk that did not come out exact is not asked for again, or this would loop on it.
        if (this.source.chunkState(index) === 'not-yet') break;
      }
    } finally {
      this.running = false;
    }
  }
}
