import { buildExactWav } from './exact-wav';
import type { RecordingPcm } from './recording-pcm';
import type { AudioLike } from './user-audio';

/** What the clock asks of the exact copy: which of its elements can play where, and a way to get one that can. */
export interface ExactGate {
  /** Whether `element` is one of the exact copies, as opposed to the recording's own file. */
  owns(element: AudioLike): boolean;
  /** Whether `element` has the audio for the `count` chunks from `seconds` on (counting the one at `seconds`), so a jump there lands exactly. */
  covers(element: AudioLike, seconds: number, count?: number): boolean;
  /**
   * Makes the chunks from `seconds` exact and offers the clock an element that has them, resolving true once it is offered, or
   * false when they could not be made exact. An element already offered that has them is not made again.
   */
  prepare(seconds: number, count?: number): Promise<boolean>;
}

/** The browser pieces the copy uses, so tests pass fakes. */
export interface ExactCopyDeps {
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  /** An audio element on the url, ready once its length is known. */
  makeElement(url: string): Promise<AudioLike>;
}

/** The part of the region queue the copy uses. */
export interface ChunkRequests {
  request(seconds: number, count?: number): Promise<boolean>;
}

/** Quiet time between making one copy and the next as more of the recording becomes exact, so a run of new chunks makes one copy. */
const REFRESH_AFTER_MS = 400;

/**
 * Seek-exact playback of a recording that is decoded a region at a time. An audio element cannot be extended, so the copy is a
 * series of full-length WAV elements, each made of the chunks that were exact when it was built. The clock takes a new one at
 * a jump, pause or loop restart (`offerElement`), and this keeps count of which chunks each has.
 */
export class ExactCopy implements ExactGate {
  private readonly coverage = new WeakMap<AudioLike, readonly boolean[]>();
  private readonly urls = new Map<AudioLike, string>();
  private latest: AudioLike | null = null;
  private inUse: AudioLike | null = null;
  private building: Promise<boolean> = Promise.resolve(true);
  private lastBuilt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly off: () => void;

  constructor(
    private readonly pcm: RecordingPcm,
    private readonly requests: ChunkRequests,
    private readonly offer: (element: AudioLike) => void,
    private readonly deps: ExactCopyDeps,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.off = pcm.onChange(() => this.scheduleRefresh());
  }

  owns(element: AudioLike): boolean {
    return this.coverage.has(element);
  }

  covers(element: AudioLike, seconds: number, count = 1): boolean {
    const covered = this.coverage.get(element);
    if (!covered) return false;
    const first = this.pcm.chunkAt(seconds);
    for (let i = first; i < first + count && i < this.pcm.chunkCount; i++) if (!covered[i]) return false;
    return true;
  }

  /** The clock took `element` over from `previous`; a copy it has left is no longer needed. */
  adopted(element: AudioLike): void {
    this.inUse = element;
    this.discard();
  }

  async prepare(seconds: number, count = 2): Promise<boolean> {
    if (this.stopped) return false;
    if (!(await this.requests.request(seconds, count))) return false;
    if (this.latest && this.covers(this.latest, seconds, count)) return true;
    return this.build();
  }

  /** Gives up the copies and stops following the store. */
  stop(): void {
    this.stopped = true;
    this.off();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const url of this.urls.values()) this.deps.revokeUrl(url);
    this.urls.clear();
  }

  /** Makes a copy of everything exact now and offers it. Copies are made one at a time. */
  private build(): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      if (this.stopped) return false;
      try {
        const { blob, covered } = buildExactWav(this.pcm);
        const url = this.deps.createUrl(blob);
        let element: AudioLike;
        try {
          element = await this.deps.makeElement(url);
        } catch {
          this.deps.revokeUrl(url);
          return false;
        }
        if (this.stopped) {
          this.deps.revokeUrl(url);
          return false;
        }
        this.coverage.set(element, covered);
        this.urls.set(element, url);
        this.latest = element;
        this.lastBuilt = this.now();
        this.offer(element);
        this.discard();
        return true;
      } catch {
        return false;
      }
    };
    const next = this.building.then(run, run);
    this.building = next;
    return next;
  }

  /** Revokes the copies that are neither the one in use nor the latest offered. */
  private discard(): void {
    for (const [element, url] of Array.from(this.urls)) {
      if (element === this.inUse || element === this.latest) continue;
      this.deps.revokeUrl(url);
      this.urls.delete(element);
    }
  }

  /** As more chunks become exact, makes a copy that has them, a little later so a run of chunks is one copy. */
  private scheduleRefresh(): void {
    if (this.stopped || this.refreshTimer) return;
    const wait = Math.max(0, REFRESH_AFTER_MS - (this.now() - this.lastBuilt));
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (this.stopped || !this.latest) return;
      const covered = this.coverage.get(this.latest);
      const states = this.pcm.chunkStates();
      if (states.some((s, i) => s === 'exact' && !covered?.[i])) void this.build();
    }, wait);
  }
}
