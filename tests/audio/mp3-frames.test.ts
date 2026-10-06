import { describe, expect, it } from 'vitest';
import { frameAtSample, mapMp3Frames, sliceForSamples, totalSamples } from '../../src/audio/mp3-frames';

/** A frame header byte pattern for MPEG-1 Layer III, stereo, no CRC. */
const mpeg1 = (bitrateIndex: number, rateIndex = 0, padding = 0, mono = false): number[] => [
  0xff,
  0xfb,
  (bitrateIndex << 4) | (rateIndex << 2) | (padding << 1),
  mono ? 0xc0 : 0x00,
];
/** MPEG-2 Layer III (0xF3), stereo. */
const mpeg2 = (bitrateIndex: number, rateIndex = 0): number[] => [0xff, 0xf3, (bitrateIndex << 4) | (rateIndex << 2), 0x00];

const frame = (header: number[], length: number): number[] => [...header, ...new Array(length - header.length).fill(0)];
const bytesOf = (...parts: number[][]): Uint8Array => Uint8Array.from(parts.flat());

// 128 kbps at 44.1 kHz: 144 * 128000 / 44100 = 417 bytes; 64 kbps: 208; 192 kbps: 626.
const f128 = () => frame(mpeg1(9), 417);
const f64 = () => frame(mpeg1(5), 208);
const f192 = () => frame(mpeg1(11), 626);

describe('mapMp3Frames', () => {
  it('maps a constant-bitrate stream to frames 417 bytes apart, 1152 samples each', () => {
    const map = mapMp3Frames(bytesOf(f128(), f128(), f128(), f128()))!;
    expect(Array.from(map.frameOffsets)).toEqual([0, 417, 834, 1251]);
    expect(map.samplesPerFrame).toBe(1152);
    expect(map.sampleRate).toBe(44100);
    expect(map.channels).toBe(2);
    expect(map.endOffset).toBe(1668);
    expect(totalSamples(map)).toBe(4 * 1152);
  });

  it('maps a variable-bitrate stream by the sum of its differing frame sizes', () => {
    const map = mapMp3Frames(bytesOf(f64(), f192(), f128(), f64()))!;
    expect(Array.from(map.frameOffsets)).toEqual([0, 208, 834, 1251]);
    expect(map.endOffset).toBe(1251 + 208);
  });

  it('counts the padding byte of a padded frame', () => {
    const padded = frame(mpeg1(9, 0, 1), 418);
    const map = mapMp3Frames(bytesOf(padded, f128(), f128()))!;
    expect(Array.from(map.frameOffsets)).toEqual([0, 418, 835]);
  });

  it('skips an ID3v2 tag before the audio', () => {
    const id3 = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)];
    const map = mapMp3Frames(bytesOf(id3, f128(), f128(), f128()))!;
    expect(Array.from(map.frameOffsets)).toEqual([30, 447, 864]);
  });

  it('leaves out a leading Xing frame, which is not audio, and reads the encoder delay from its LAME tag', () => {
    const info = frame(mpeg1(9), 417);
    info.splice(36, 4, 0x58, 0x69, 0x6e, 0x67); // "Xing" after the header and 32 bytes of side info
    info[43] = 0; // no optional fields
    info.splice(44, 4, 0x4c, 0x41, 0x4d, 0x45); // "LAME"
    info[44 + 21] = 0x24; // delay 576 = 0x240, padding 1000 = 0x3E8
    info[44 + 22] = 0x03;
    info[44 + 23] = 0xe8;
    const map = mapMp3Frames(bytesOf(info, f128(), f128(), f128()))!;
    expect(Array.from(map.frameOffsets)).toEqual([417, 834, 1251]);
    expect(map.encoderDelay).toBe(576);
    expect(map.endPadding).toBe(1000);
  });

  it('gives MPEG-2 streams 576 samples a frame, and mono streams one channel', () => {
    // MPEG-2, 64 kbps (index 8) at 22.05 kHz: 72 * 64000 / 22050 = 208 bytes.
    const two = mapMp3Frames(bytesOf(frame(mpeg2(8), 208), frame(mpeg2(8), 208), frame(mpeg2(8), 208)))!;
    expect(two.samplesPerFrame).toBe(576);
    expect(two.sampleRate).toBe(22050);
    const mono = mapMp3Frames(bytesOf(frame(mpeg1(9, 0, 0, true), 417), frame(mpeg1(9, 0, 0, true), 417), frame(mpeg1(9, 0, 0, true), 417)))!;
    expect(mono.channels).toBe(1);
  });

  it('stops at a truncated final frame rather than guess its length', () => {
    const map = mapMp3Frames(bytesOf(f128(), f128(), f128(), f128().slice(0, 200)))!;
    expect(Array.from(map.frameOffsets)).toEqual([0, 417, 834]);
    expect(map.endOffset).toBe(1251);
  });

  it('stops at a damaged frame', () => {
    const map = mapMp3Frames(bytesOf(f128(), f128(), f128(), [1, 2, 3, 4, 5], f128()))!;
    expect(Array.from(map.frameOffsets)).toEqual([0, 417, 834]);
  });

  it('finds the first frame after a little padding', () => {
    const map = mapMp3Frames(bytesOf([0, 0, 0, 0, 0, 0], f128(), f128(), f128()))!;
    expect(Array.from(map.frameOffsets)).toEqual([6, 423, 840]);
  });

  it('is null for things that are not MP3: WAV, an M4A header, free format, Layer II, and empty input', () => {
    const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, ...new Array(200).fill(0)]);
    const m4a = Uint8Array.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, ...new Array(200).fill(0)]);
    expect(mapMp3Frames(wav)).toBeNull();
    expect(mapMp3Frames(m4a)).toBeNull();
    expect(mapMp3Frames(bytesOf(frame(mpeg1(0), 417), frame(mpeg1(0), 417)))).toBeNull();
    expect(mapMp3Frames(bytesOf(frame([0xff, 0xfd, 0x90, 0x00], 417)))).toBeNull();
    expect(mapMp3Frames(new Uint8Array(0))).toBeNull();
  });
});

describe('telling an MP3 from other audio', () => {
  it('is null for a stray frame header among other bytes, or fewer than three frames in a row', () => {
    const noise = new Array(300).fill(0x5a);
    expect(mapMp3Frames(bytesOf(noise, f128(), noise))).toBeNull();
    expect(mapMp3Frames(bytesOf(f128()))).toBeNull();
    expect(mapMp3Frames(bytesOf(f128(), f128()))).toBeNull();
    expect(mapMp3Frames(bytesOf(f128(), f128(), f128()))).not.toBeNull();
  });

  it('is null for random bytes, whatever stray header-shaped run they happen to hold', () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8;
    for (let trial = 0; trial < 300; trial++) {
      const random = Uint8Array.from({ length: 4200 }, () => next() & 255);
      expect(mapMp3Frames(random)).toBeNull();
    }
  });
});

describe('frameAtSample and sliceForSamples', () => {
  const map = mapMp3Frames(bytesOf(...Array.from({ length: 10 }, f128)))!;

  it('finds the frame that holds a sample, clamped to the frames there are', () => {
    expect(frameAtSample(map, 0)).toBe(0);
    expect(frameAtSample(map, 1151)).toBe(0);
    expect(frameAtSample(map, 1152)).toBe(1);
    expect(frameAtSample(map, 1e9)).toBe(9);
    expect(frameAtSample(map, -5)).toBe(0);
  });

  it('cuts the bytes that cover a stretch of samples, with whole lead-in frames before it', () => {
    const slice = sliceForSamples(map, 3 * 1152 + 10, 5 * 1152, 2);
    expect(slice.firstFrame).toBe(1);
    expect(slice.lastFrame).toBe(4);
    expect(slice.byteStart).toBe(417);
    expect(slice.byteEnd).toBe(5 * 417);
  });

  it('does not reach before the first frame or past the last', () => {
    const start = sliceForSamples(map, 0, 1152, 3);
    expect(start.firstFrame).toBe(0);
    const end = sliceForSamples(map, 9 * 1152, 1e9, 1);
    expect(end.lastFrame).toBe(9);
    expect(end.byteEnd).toBe(map.endOffset);
  });
});
