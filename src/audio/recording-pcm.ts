import type { PcmAudio } from '../export/audio';
import { AUDIO_SAMPLE_RATE } from '../export/presets';
import { frameAtSample, mapMp3Frames, sliceForSamples, totalSamples, type Mp3FrameMap } from './mp3-frames';

/** Seconds of the recording in each chunk. Whole seconds, so a chunk's edges are whole samples at any sample rate. */
export const CHUNK_SECONDS = 10;
/** Seconds of audio kept decoded at once; a longer recording keeps the stretches nearest where it is played. */
export const BUDGET_SECONDS = 600;
/** Whole frames decoded before a stretch for the decoder to settle on; an MP3 frame can borrow bits from the frames before it. */
const LEAD_IN_FRAMES = 4;
/** How far past the first chunk the prefix used to line the timeline up reaches, in samples; the start trim is a few thousand at most. */
const CALIBRATION_MARGIN_SAMPLES = 8192;

/** Where a chunk stands: not started, being decoded, ready, or failed to decode. */
export type ChunkState = 'not-yet' | 'getting' | 'exact' | 'failed';

/** A decoded stretch of the recording as 16-bit samples, starting at `index * chunkSamples`. */
export interface Chunk {
  readonly index: number;
  readonly left: Int16Array;
  readonly right: Int16Array;
}

/** The browser piece the store uses, so tests pass a fake. `sampleRate` asks for the result at that rate; omitted means the export rate. */
export interface PcmDeps {
  decode(bytes: ArrayBuffer, sampleRate?: number): Promise<PcmAudio>;
}

const browserDeps: PcmDeps = {
  async decode(bytes, sampleRate = AUDIO_SAMPLE_RATE) {
    const offline = new OfflineAudioContext(2, 1, sampleRate);
    const decoded = await offline.decodeAudioData(bytes);
    // Reading only, so the decoded buffer's own channel data is used without a copy.
    const left = decoded.getChannelData(0);
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
    return { left, right, sampleRate: decoded.sampleRate };
  },
};

export type OpenResult =
  | { readonly kind: 'ready'; readonly pcm: RecordingPcm }
  /** No decoded copy can be kept: the file cannot be decoded, or it is not MP3 and is longer than the budget. */
  | { readonly kind: 'not-possible'; readonly reason: 'too-long' | 'undecodable' };

export interface RecordingPcmOptions {
  readonly chunkSeconds?: number;
  readonly budgetSeconds?: number;
  readonly leadInFrames?: number;
}

const toInt16 = (value: number): number => Math.max(-32768, Math.min(32767, Math.round(value * 32767)));

function pack(source: Float32Array, from: number, length: number): Int16Array {
  const out = new Int16Array(length);
  const end = Math.min(source.length, from + length);
  for (let i = Math.max(0, from); i < end; i++) out[i - from] = toInt16(source[i]);
  return out;
}

/**
 * The decoded audio of one recording, kept as chunks, shared by seeking, analysis and export. An MP3 is decoded a chunk at a
 * time from the bytes that cover it, so the stretch the player is at can be ready long before the rest; any other format is
 * decoded whole, once, and only when it fits the budget. The chunks are on the timeline a whole-file decode of the same file has.
 */
export class RecordingPcm {
  readonly chunkSamples: number;
  readonly chunkCount: number;
  private readonly budgetChunks: number;
  private readonly chunks = new Map<number, Chunk>();
  private readonly states: ChunkState[];
  private readonly used = new Map<number, number>();
  private clock = 0;
  private focus: ReadonlySet<number> = new Set();
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Map<number, Promise<void>>();
  /** Decoding is one chunk at a time, so it never competes with itself for memory. */
  private queue: Promise<void> = Promise.resolve();
  /** Samples a whole-file decode drops from the start of the frame timeline; learned from the first chunk. */
  private startTrim: number | null = null;
  private released = false;

  private constructor(
    readonly sampleRate: number,
    readonly durationSeconds: number,
    private readonly bytes: ArrayBuffer | null,
    private readonly map: Mp3FrameMap | null,
    private readonly deps: PcmDeps,
    private readonly leadIn: number,
    chunkSeconds: number,
    budgetSeconds: number,
  ) {
    this.chunkSamples = Math.round(chunkSeconds * sampleRate);
    this.chunkCount = Math.max(1, Math.ceil(durationSeconds / chunkSeconds));
    this.budgetChunks = Math.max(1, Math.ceil(budgetSeconds / chunkSeconds));
    this.states = new Array<ChunkState>(this.chunkCount).fill('not-yet');
  }

  /** Seconds in each chunk. */
  get chunkSeconds(): number {
    return this.chunkSamples / this.sampleRate;
  }

  /** How many chunks fit in the budget. */
  get capacityChunks(): number {
    return this.budgetChunks;
  }

  /** How many chunks are exact now. */
  get exactCount(): number {
    return this.chunks.size;
  }

  /** Whether chunks are decoded one at a time (an MP3) rather than all at once. */
  get byRegion(): boolean {
    return this.map !== null;
  }

  /**
   * Reads the file and decides how it can be decoded. `durationSeconds` is the recording's length from its audio element. A
   * non-MP3 file is decoded whole right away, so this resolves once it is decoded; an MP3 resolves at once with nothing decoded.
   */
  static async open(file: Blob, durationSeconds: number, deps: PcmDeps = browserDeps, options: RecordingPcmOptions = {}): Promise<OpenResult> {
    const chunkSeconds = options.chunkSeconds ?? CHUNK_SECONDS;
    const budgetSeconds = options.budgetSeconds ?? BUDGET_SECONDS;
    const leadIn = options.leadInFrames ?? LEAD_IN_FRAMES;
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      return { kind: 'not-possible', reason: 'undecodable' };
    }
    const map = mapMp3Frames(new Uint8Array(bytes));
    if (map) return { kind: 'ready', pcm: new RecordingPcm(map.sampleRate, durationSeconds, bytes, map, deps, leadIn, chunkSeconds, budgetSeconds) };
    if (durationSeconds > budgetSeconds) return { kind: 'not-possible', reason: 'too-long' };
    try {
      const decoded = await deps.decode(bytes);
      const pcm = new RecordingPcm(decoded.sampleRate, durationSeconds, null, null, deps, leadIn, chunkSeconds, budgetSeconds);
      pcm.fillWhole(decoded);
      return { kind: 'ready', pcm };
    } catch {
      return { kind: 'not-possible', reason: 'undecodable' };
    }
  }

  chunkState(index: number): ChunkState {
    return this.states[index] ?? 'not-yet';
  }

  /** The state of every chunk, in order. */
  chunkStates(): readonly ChunkState[] {
    return this.states.slice();
  }

  /** The chunk that holds a position in the recording, in seconds. */
  chunkAt(seconds: number): number {
    return Math.min(this.chunkCount - 1, Math.max(0, Math.floor(seconds / (this.chunkSamples / this.sampleRate))));
  }

  /** The decoded chunk, or null when it is not exact yet. Reading it counts as using it. */
  get(index: number): Chunk | null {
    const chunk = this.chunks.get(index) ?? null;
    if (chunk) this.used.set(index, ++this.clock);
    return chunk;
  }

  /** True when every chunk is exact. */
  get complete(): boolean {
    return this.states.every((s) => s === 'exact');
  }

  /** The chunks the player is at or is about to use; these are not released to make room. */
  setFocus(indices: Iterable<number>): void {
    this.focus = new Set(indices);
  }

  /** Called whenever a chunk changes state. Returns a function that stops listening. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Decodes a chunk if it is not already, resolving when it is exact (or has failed). Never rejects. */
  ensure(index: number): Promise<void> {
    if (this.released || index < 0 || index >= this.chunkCount) return Promise.resolve();
    if (this.states[index] === 'exact' || this.states[index] === 'failed') return Promise.resolve();
    const running = this.inFlight.get(index);
    if (running) return running;
    this.setState(index, 'getting');
    const started = this.queue.then(() => this.decodeChunk(index));
    this.queue = started.catch(() => undefined);
    const tracked = started
      .catch(() => this.setState(index, 'failed'))
      .finally(() => this.inFlight.delete(index));
    this.inFlight.set(index, tracked);
    return tracked;
  }

  /**
   * The audio from `fromSeconds` to `toSeconds` as float PCM on the recording's own timeline, decoding what is missing, or null
   * when it cannot all be kept at once (longer than the budget) or a chunk failed.
   */
  async read(fromSeconds: number, toSeconds: number): Promise<PcmAudio | null> {
    const seconds = this.chunkSamples / this.sampleRate;
    const first = this.chunkAt(fromSeconds);
    const last = this.chunkAt(Math.max(fromSeconds, toSeconds - 1e-9));
    if (last - first + 1 > this.budgetChunks) return null;
    this.setFocus(Array.from({ length: last - first + 1 }, (_, i) => first + i));
    for (let i = first; i <= last; i++) await this.ensure(i);
    const from = Math.round(fromSeconds * this.sampleRate);
    const length = Math.max(0, Math.round(toSeconds * this.sampleRate) - from);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let i = first; i <= last; i++) {
      const chunk = this.get(i);
      if (!chunk) return null;
      const base = Math.round(i * seconds * this.sampleRate);
      const start = Math.max(from, base);
      const end = Math.min(from + length, base + chunk.left.length);
      for (let s = start; s < end; s++) {
        left[s - from] = chunk.left[s - base] / 32767;
        right[s - from] = chunk.right[s - base] / 32767;
      }
    }
    return { left, right, sampleRate: this.sampleRate };
  }

  /** The whole recording as float PCM, or null when it is longer than the budget or a chunk failed. */
  readAll(): Promise<PcmAudio | null> {
    return this.read(0, this.durationSeconds);
  }

  /** Gives up the decoded audio; nothing more is decoded and every chunk reads as not yet. */
  release(): void {
    this.released = true;
    this.chunks.clear();
    this.used.clear();
    this.states.fill('not-yet');
    this.notify();
  }

  private setState(index: number, state: ChunkState): void {
    if (this.states[index] === state) return;
    this.states[index] = state;
    this.notify();
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }

  private store(chunk: Chunk): void {
    if (this.released) return;
    while (this.chunks.size >= this.budgetChunks) {
      let oldest: number | null = null;
      for (const index of this.chunks.keys()) {
        if (this.focus.has(index)) continue;
        if (oldest === null || (this.used.get(index) ?? 0) < (this.used.get(oldest) ?? 0)) oldest = index;
      }
      if (oldest === null) break;
      this.chunks.delete(oldest);
      this.used.delete(oldest);
      this.states[oldest] = 'not-yet';
    }
    this.chunks.set(chunk.index, chunk);
    this.used.set(chunk.index, ++this.clock);
    this.setState(chunk.index, 'exact');
  }

  /** A non-MP3 recording, decoded whole, split into chunks. */
  private fillWhole(decoded: PcmAudio): void {
    for (let i = 0; i < this.chunkCount; i++) {
      this.store({ index: i, left: pack(decoded.left, i * this.chunkSamples, this.chunkSamples), right: pack(decoded.right, i * this.chunkSamples, this.chunkSamples) });
    }
  }

  private async decodeChunk(index: number): Promise<void> {
    const map = this.map;
    if (!map || !this.bytes || this.released) return;
    if (this.startTrim === null) await this.calibrate();
    if (this.released || this.states[index] === 'exact') return;
    const c0 = index * this.chunkSamples;
    const c1 = c0 + this.chunkSamples;
    const trim = this.startTrim ?? 0;
    // Where the chunk sits on the frame timeline, which a whole-file decode starts `trim` samples into.
    const slice = sliceForSamples(map, c0 + trim, Math.min(c1 + trim, totalSamples(map)), this.leadIn);
    const decoded = await this.deps.decode(this.bytes.slice(slice.byteStart, slice.byteEnd), map.sampleRate);
    if (this.released) return;
    // Line up from the end of the slice: whatever the decoder dropped or kept at its start, it ends at the end of its last frame.
    // A chunk that runs past the last frame, or begins before what the decoder gave, is padded with silence.
    const output = decoded.left.length;
    const endOfLastFrame = (slice.lastFrame + 1) * map.samplesPerFrame;
    const start = output - (endOfLastFrame - (c1 + trim)) - this.chunkSamples;
    this.store({ index, left: this.cut(decoded.left, start), right: this.cut(decoded.right, start) });
  }

  /** A chunk's worth of samples from `source` beginning at `start`, which may be before the start or past the end of it. */
  private cut(source: Float32Array, start: number): Int16Array {
    const out = new Int16Array(this.chunkSamples);
    const skip = Math.max(0, -start);
    out.set(pack(source, Math.max(0, start), this.chunkSamples - skip), skip);
    return out;
  }

  /**
   * Finds how many samples a whole-file decode drops from the start of the frames, by decoding the start of the file the way
   * a whole-file decode does (from byte zero, tags and all) and comparing its length with the frames it covers.
   */
  private async calibrate(): Promise<void> {
    const map = this.map!;
    const last = frameAtSample(map, this.chunkSamples + CALIBRATION_MARGIN_SAMPLES);
    const end = last + 1 < map.frameOffsets.length ? map.frameOffsets[last + 1] : map.endOffset;
    const decoded = await this.deps.decode(this.bytes!.slice(0, end), map.sampleRate);
    const covered = (last + 1) * map.samplesPerFrame;
    this.startTrim = Math.max(0, covered - decoded.left.length);
    if (this.released) return;
    // The prefix is the file start decoded as a whole-file decode does, so chunk 0 comes straight from it.
    if (this.states[0] !== 'exact') {
      this.store({ index: 0, left: pack(decoded.left, 0, this.chunkSamples), right: pack(decoded.right, 0, this.chunkSamples) });
    }
  }
}
