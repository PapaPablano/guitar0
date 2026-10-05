import { encodeWav } from '../export/audio-file';
import { AUDIO_SAMPLE_RATE } from '../export/presets';
import type { PcmAudio } from '../export/audio';
import { hashFile } from '../stems/file-hash';

/** Recordings longer than this are not copied: the decode would cost more memory than the copy is worth. */
export const EXACT_COPY_MAX_SECONDS = 600;
/** How many copies are kept at once, so memory stays bounded across songs in one session. */
const KEPT_COPIES = 2;

/** The outcome of asking for a copy. A copy that was not made is never an error the caller must handle. */
export type ExactCopyResult =
  | { readonly kind: 'copy'; readonly url: string; readonly release: () => void }
  | { readonly kind: 'skipped'; readonly reason: 'already-wav' | 'too-long' }
  | { readonly kind: 'failed' };

/** The browser pieces the builder uses, so tests pass fakes. */
export interface ExactCopyDeps {
  decode(file: Blob): Promise<PcmAudio>;
  encode(pcm: PcmAudio): Uint8Array<ArrayBuffer>;
  hash(file: File): Promise<string>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
}

const browserDeps: ExactCopyDeps = {
  async decode(file) {
    const offline = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
    const decoded = await offline.decodeAudioData(await file.arrayBuffer());
    // Encoding only reads the samples, so the decoded buffer's own channel data is used without a second copy.
    const left = decoded.getChannelData(0);
    const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
    return { left, right, sampleRate: decoded.sampleRate };
  },
  encode: encodeWav,
  hash: hashFile,
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
};

function isWav(file: File): boolean {
  return /^audio\/(x-)?wav(e)?$/i.test(file.type) || /\.wav$/i.test(file.name);
}

interface Entry {
  readonly url: string;
  claims: number;
}

/**
 * Makes seek-exact WAV copies of recordings. Compressed files such as MP3 seek inexactly, so a loop that
 * restarts by seeking can land on a slightly different spot each pass; a WAV copy seeks to the sample. Copies
 * are kept in memory for the page session, at most a few at a time, and keyed by file content.
 */
export class ExactCopyBuilder {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Entry | null>>();

  constructor(
    private readonly deps: ExactCopyDeps = browserDeps,
    private readonly keep: number = KEPT_COPIES,
  ) {}

  /** `durationSeconds` is the recording's length from its audio element, known before anything is decoded. */
  async build(file: File, durationSeconds: number): Promise<ExactCopyResult> {
    if (isWav(file)) return { kind: 'skipped', reason: 'already-wav' };
    if (durationSeconds > EXACT_COPY_MAX_SECONDS) return { kind: 'skipped', reason: 'too-long' };
    try {
      const key = await this.deps.hash(file);
      const entry = await this.entryFor(key, file);
      if (!entry) return { kind: 'failed' };
      entry.claims += 1;
      let released = false;
      return {
        kind: 'copy',
        url: entry.url,
        release: () => {
          if (released) return;
          released = true;
          entry.claims -= 1;
        },
      };
    } catch {
      return { kind: 'failed' };
    }
  }

  private entryFor(key: string, file: File): Promise<Entry | null> {
    const kept = this.entries.get(key);
    if (kept) return Promise.resolve(kept);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const started = this.make(file)
      .then((entry) => {
        this.makeRoom();
        this.entries.set(key, entry);
        return entry;
      })
      .catch(() => null)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, started);
    return started;
  }

  private async make(file: File): Promise<Entry> {
    const pcm = await this.deps.decode(file);
    const wav = this.deps.encode(pcm);
    return { url: this.deps.createUrl(new Blob([wav], { type: 'audio/wav' })), claims: 0 };
  }

  /** Drops the oldest copy nobody is playing from when the cache is full; a copy in use is never dropped. */
  private makeRoom(): void {
    if (this.entries.size < this.keep) return;
    for (const [key, entry] of this.entries) {
      if (entry.claims > 0) continue;
      this.deps.revokeUrl(entry.url);
      this.entries.delete(key);
      return;
    }
  }
}
