import { mapMp3Frames } from '../../src/audio/mp3-frames';
import type { PcmDeps } from '../../src/audio/recording-pcm';
import type { PcmAudio } from '../../src/export/audio';

export const RATE = 44100;
export const SPF = 1152;
export const FRAME_BYTES = 417;
export const FRAMES = 2000; // about 52 seconds

/** An MP3-shaped stream whose every frame carries its own index in its payload; optionally led by a Xing frame. */
export function stream(frames: number, xing: boolean): Uint8Array {
  const out: number[] = [];
  const header = [0xff, 0xfb, 0x90, 0x00];
  if (xing) {
    const info = [...header, ...new Array(FRAME_BYTES - 4).fill(0)];
    info.splice(36, 4, 0x58, 0x69, 0x6e, 0x67);
    out.push(...info);
  }
  for (let i = 0; i < frames; i++) {
    const frame = [...header, (i >>> 24) & 255, (i >>> 16) & 255, (i >>> 8) & 255, i & 255, ...new Array(FRAME_BYTES - 8).fill(0)];
    out.push(...frame);
  }
  return Uint8Array.from(out);
}

/** The value the fake decoder gives the sample at frame-timeline position `g`: a sawtooth, so a misplaced sample shows. */
export const saw = (g: number): number => ((g % 1000) / 1000) * 0.9;
export const fromSaw = (int16: number): number => Math.round(((int16 / 32767) / 0.9) * 1000) % 1000;

export interface Fake extends PcmDeps {
  calls: { bytes: number; rate: number | undefined }[];
}

/**
 * A stand-in decoder for streams made by `stream`. A decode that starts at the file start with a Xing frame drops `trim`
 * samples from the front, as a whole-file decode does with a LAME tag; one that starts in the middle drops `dropLead` frames
 * the decoder had no bit reservoir for.
 */
export function fakeDecoder(options: { trim?: number; dropLead?: number; fail?: (call: number) => boolean } = {}): Fake {
  const { trim = 0, dropLead = 0, fail = () => false } = options;
  const fake: Fake = {
    calls: [],
    async decode(buffer, rate) {
      fake.calls.push({ bytes: buffer.byteLength, rate });
      if (fail(fake.calls.length)) throw new Error('cannot decode');
      const bytes = new Uint8Array(buffer);
      const map = mapMp3Frames(bytes);
      if (!map) throw new Error('not audio');
      const index = (at: number) => (bytes[at + 4] << 24) | (bytes[at + 5] << 16) | (bytes[at + 6] << 8) | bytes[at + 7];
      const firstIndex = index(map.frameOffsets[0]);
      const atFileStart = firstIndex === 0 && map.frameOffsets[0] > 0;
      const frames = Array.from(map.frameOffsets, (offset) => index(offset));
      const kept = atFileStart ? frames : frames.slice(firstIndex === 0 ? 0 : dropLead);
      const values: number[] = [];
      for (const f of kept) for (let i = 0; i < SPF; i++) values.push(saw(f * SPF + i));
      const samples = Float32Array.from(atFileStart ? values.slice(trim) : values);
      return { left: samples, right: samples, sampleRate: rate ?? 48000 } satisfies PcmAudio;
    },
  };
  return fake;
}

