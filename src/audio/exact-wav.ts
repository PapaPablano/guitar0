import type { Chunk, RecordingPcm } from './recording-pcm';

/** The 44-byte header of a 16-bit stereo PCM WAV holding `frames` sample frames. */
export function wavHeader(sampleRate: number, frames: number): Uint8Array<ArrayBuffer> {
  const dataBytes = frames * 4;
  const header = new Uint8Array(new ArrayBuffer(44));
  const view = new DataView(header.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); // bytes a second
  view.setUint16(32, 4, true); // bytes a frame
  view.setUint16(34, 16, true); // bits
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}

const blobs = new WeakMap<Chunk, Blob>();
const silences = new Map<number, Blob>();

/** The chunk's samples interleaved as WAV data, `frames` of them. A whole chunk's blob is kept, so the copy built next reuses it. */
function chunkBlob(chunk: Chunk, frames: number): Blob {
  const whole = frames === chunk.left.length;
  const kept = whole ? blobs.get(chunk) : undefined;
  if (kept) return kept;
  const data = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    data[2 * i] = chunk.left[i];
    data[2 * i + 1] = chunk.right[i];
  }
  const blob = new Blob([data]);
  if (whole) blobs.set(chunk, blob);
  return blob;
}

/** `frames` of silence as WAV data; one block is shared by every gap, and a blob built from blobs holds references, not copies. */
function silence(frames: number, chunkFrames: number): Blob {
  let block = silences.get(chunkFrames);
  if (!block) {
    block = new Blob([new Uint8Array(chunkFrames * 4)]);
    silences.set(chunkFrames, block);
  }
  return frames === chunkFrames ? block : block.slice(0, frames * 4);
}

export interface ExactWav {
  readonly blob: Blob;
  /** Which chunks of the recording have their audio in this file; the rest are silence. */
  readonly covered: readonly boolean[];
}

/**
 * A WAV as long as the recording, made of the chunks that are exact now and silence for the rest. The file is the length of the
 * whole recording, so a position in it is the position in the recording, but only the covered chunks may be played.
 */
export function buildExactWav(pcm: RecordingPcm): ExactWav {
  const frames = Math.round(pcm.durationSeconds * pcm.sampleRate);
  const parts: BlobPart[] = [wavHeader(pcm.sampleRate, frames)];
  const covered: boolean[] = [];
  for (let i = 0; i < pcm.chunkCount; i++) {
    const n = Math.min(pcm.chunkSamples, frames - i * pcm.chunkSamples);
    if (n <= 0) break;
    const chunk = pcm.get(i);
    covered.push(chunk !== null);
    parts.push(chunk ? chunkBlob(chunk, n) : silence(n, pcm.chunkSamples));
  }
  return { blob: new Blob(parts, { type: 'audio/wav' }), covered };
}
