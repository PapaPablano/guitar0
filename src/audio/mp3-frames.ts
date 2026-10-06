/**
 * Where every frame of an MP3 starts, found from the frame headers alone, without decoding anything. A frame always holds
 * the same number of samples, so with each frame's byte offset the sample position of any byte is known, and the bytes that
 * cover a stretch of the recording can be cut out and decoded by themselves.
 */

/** Layer III bitrates in kilobits per second, by header index; index 0 is "free format", which is not read, and 15 is invalid. */
const BITRATES_MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] as const;
const BITRATES_MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] as const;
const SAMPLE_RATES: Record<'1' | '2' | '2.5', readonly number[]> = {
  '1': [44100, 48000, 32000],
  '2': [22050, 24000, 16000],
  '2.5': [11025, 12000, 8000],
};

export interface Mp3FrameMap {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  /** Samples in every frame: 1152 for MPEG-1, 576 for MPEG-2 and 2.5. */
  readonly samplesPerFrame: number;
  /** Byte offset of each audio frame, in order; a leading Xing or Info frame is not audio and is left out. */
  readonly frameOffsets: Uint32Array;
  /** Byte offset one past the last frame. */
  readonly endOffset: number;
  /** Samples the encoder added at the start, from the LAME tag, or 0 when there is none. */
  readonly encoderDelay: number;
  /** Samples of padding the encoder added at the end, from the LAME tag, or 0 when there is none. */
  readonly endPadding: number;
}

interface Header {
  readonly version: '1' | '2' | '2.5';
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly bytes: number;
  readonly samples: number;
  readonly protectedByCrc: boolean;
}

/** The frame header at `at`, or null when the bytes there are not a valid Layer III header. */
function readHeader(bytes: Uint8Array, at: number): Header | null {
  if (at + 4 > bytes.length) return null;
  const b1 = bytes[at + 1];
  if (bytes[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const versionBits = (b1 >> 3) & 3;
  const layerBits = (b1 >> 1) & 3;
  if (versionBits === 1 || layerBits !== 1) return null;
  const version = versionBits === 3 ? '1' : versionBits === 2 ? '2' : '2.5';
  const b2 = bytes[at + 2];
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const bitrate = (version === '1' ? BITRATES_MPEG1 : BITRATES_MPEG2)[bitrateIndex] * 1000;
  const padding = (b2 >> 1) & 1;
  const samples = version === '1' ? 1152 : 576;
  const bytesInFrame = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  return { version, sampleRate, channels: (bytes[at + 3] >> 6) === 3 ? 1 : 2, bytes: bytesInFrame, samples, protectedByCrc: (b1 & 1) === 0 };
}

/** Bytes taken by an ID3v2 tag at the start of the file, or 0. */
function id3Length(bytes: Uint8Array): number {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const footer = bytes[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

const matches = (bytes: Uint8Array, at: number, text: string): boolean => {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};

/** Whether the frame at `at` is a Xing or Info header frame (no audio), and the LAME delay and padding it carries. */
function readInfoFrame(bytes: Uint8Array, at: number, header: Header): { delay: number; padding: number } | null {
  const sideInfo = header.version === '1' ? (header.channels === 1 ? 17 : 32) : header.channels === 1 ? 9 : 17;
  const tag = at + 4 + (header.protectedByCrc ? 2 : 0) + sideInfo;
  if (!matches(bytes, tag, 'Xing') && !matches(bytes, tag, 'Info')) return null;
  // The LAME tag, when there is one, follows the Xing fields: 9 bytes of encoder name and version, then delay and padding as two 12-bit values.
  const flags = bytes[tag + 7] ?? 0;
  let lame = tag + 8;
  if (flags & 1) lame += 4;
  if (flags & 2) lame += 4;
  if (flags & 4) lame += 100;
  if (flags & 8) lame += 4;
  if (!matches(bytes, lame, 'LAME') && !matches(bytes, lame, 'Lavf') && !matches(bytes, lame, 'Lavc')) return { delay: 0, padding: 0 };
  const d = lame + 21;
  if (d + 3 > bytes.length) return { delay: 0, padding: 0 };
  return { delay: (bytes[d] << 4) | (bytes[d + 1] >> 4), padding: ((bytes[d + 1] & 0x0f) << 8) | bytes[d + 2] };
}

/**
 * Maps the audio frames of an MP3. Null when the bytes are not an MP3 this can read (no Layer III frame where the audio
 * should start, or a free-format stream). Reading stops at the first damaged frame, so what is returned is always whole frames.
 */
export function mapMp3Frames(bytes: Uint8Array): Mp3FrameMap | null {
  let at = id3Length(bytes);
  let first = readHeader(bytes, at);
  // Some files carry a little padding before the first frame; look a short way for it.
  for (let skipped = 0; !first && skipped < 4096 && at + 1 < bytes.length; skipped++) first = readHeader(bytes, ++at);
  if (!first) return null;

  let encoderDelay = 0;
  let endPadding = 0;
  const info = readInfoFrame(bytes, at, first);
  if (info) {
    encoderDelay = info.delay;
    endPadding = info.padding;
    at += first.bytes;
  }

  const offsets: number[] = [];
  let reference = first;
  while (at < bytes.length) {
    const header = readHeader(bytes, at);
    if (!header || header.sampleRate !== reference.sampleRate || header.version !== reference.version || at + header.bytes > bytes.length) break;
    reference = header;
    offsets.push(at);
    at += header.bytes;
  }
  if (offsets.length === 0) return null;
  return {
    sampleRate: first.sampleRate,
    channels: first.channels,
    samplesPerFrame: first.samples,
    frameOffsets: Uint32Array.from(offsets),
    endOffset: at,
    encoderDelay,
    endPadding,
  };
}

/** The frame that holds `sample` (a sample position from the start of the audio frames), clamped to the frames there are. */
export function frameAtSample(map: Mp3FrameMap, sample: number): number {
  return Math.min(map.frameOffsets.length - 1, Math.max(0, Math.floor(sample / map.samplesPerFrame)));
}

/** Total samples in the audio frames. */
export function totalSamples(map: Mp3FrameMap): number {
  return map.frameOffsets.length * map.samplesPerFrame;
}

/** The bytes to cut out of the file to decode samples `[from, to)`, with `leadInFrames` whole frames before them for the decoder to settle on. */
export interface FrameSlice {
  readonly firstFrame: number;
  readonly lastFrame: number;
  readonly byteStart: number;
  readonly byteEnd: number;
}

export function sliceForSamples(map: Mp3FrameMap, from: number, to: number, leadInFrames: number): FrameSlice {
  const last = frameAtSample(map, Math.max(from, to - 1));
  const first = Math.max(0, frameAtSample(map, from) - Math.max(0, leadInFrames));
  return {
    firstFrame: first,
    lastFrame: last,
    byteStart: map.frameOffsets[first],
    byteEnd: last + 1 < map.frameOffsets.length ? map.frameOffsets[last + 1] : map.endOffset,
  };
}
