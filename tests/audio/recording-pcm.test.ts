import { describe, expect, it } from 'vitest';
import { RecordingPcm, type PcmDeps } from '../../src/audio/recording-pcm';
import type { PcmAudio } from '../../src/export/audio';
import { FRAMES, RATE, SPF, FRAME_BYTES, fakeDecoder, fromSaw, stream } from './mp3-fixture';

const open = async (deps: PcmDeps, over: { xing?: boolean; budgetSeconds?: number } = {}) => {
  const bytes = stream(FRAMES, over.xing ?? true);
  const result = await RecordingPcm.open(new Blob([bytes.buffer as ArrayBuffer]), (FRAMES * SPF) / RATE, deps, { budgetSeconds: over.budgetSeconds });
  if (result.kind !== 'ready') throw new Error('expected a store');
  return result.pcm;
};

/** Every sample of a chunk is where the whole-file timeline (the frame timeline less `trim`) says it should be. */
function expectOnTimeline(pcm: RecordingPcm, index: number, trim: number): void {
  const chunk = pcm.get(index)!;
  const base = index * pcm.chunkSamples + trim;
  for (const k of [0, 1, 500, 1151, 1152, 100000, pcm.chunkSamples - 2, pcm.chunkSamples - 1]) {
    if (base + k >= FRAMES * SPF) continue;
    expect(fromSaw(chunk.left[k])).toBe((base + k) % 1000);
  }
}

describe('RecordingPcm of an MP3', () => {
  it('decodes nothing until a chunk is asked for, and reports every chunk as not yet', async () => {
    const deps = fakeDecoder();
    const pcm = await open(deps);
    expect(deps.calls).toHaveLength(0);
    expect(pcm.byRegion).toBe(true);
    expect(pcm.sampleRate).toBe(RATE);
    expect(pcm.chunkStates().every((s) => s === 'not-yet')).toBe(true);
  });

  it('puts a chunk decoded from the middle on the same timeline as a whole-file decode, whatever the decoder drops', async () => {
    for (const [trim, dropLead] of [[1105, 2], [0, 0], [2257, 1], [576, 3]]) {
      const pcm = await open(fakeDecoder({ trim, dropLead }));
      for (const index of [3, 1, 2, 4]) {
        await pcm.ensure(index);
        expect(pcm.chunkState(index)).toBe('exact');
        expectOnTimeline(pcm, index, trim);
      }
    }
  });

  it('learns the start trim from the file start, which also makes chunk 0 exact without a second decode', async () => {
    const deps = fakeDecoder({ trim: 1105 });
    const pcm = await open(deps);
    await pcm.ensure(3);
    expect(pcm.chunkState(0)).toBe('exact');
    expectOnTimeline(pcm, 0, 1105);
    expect(deps.calls).toHaveLength(2);
    await pcm.ensure(0);
    expect(deps.calls).toHaveLength(2);
  });

  it('decodes only the frames that cover the chunk, plus a few before it, at the file\'s own sample rate', async () => {
    const deps = fakeDecoder({ trim: 1105, dropLead: 2 });
    const pcm = await open(deps);
    await pcm.ensure(2);
    const slice = deps.calls[deps.calls.length - 1];
    const framesInChunk = Math.ceil(pcm.chunkSamples / SPF) + 1;
    expect(slice.rate).toBe(RATE);
    expect(slice.bytes).toBeLessThanOrEqual((framesInChunk + 4 + 1) * FRAME_BYTES);
    expect(slice.bytes).toBeGreaterThanOrEqual(framesInChunk * FRAME_BYTES);
  });

  it('pads the last chunk with silence where the recording ends', async () => {
    const pcm = await open(fakeDecoder({ trim: 1105 }));
    const last = pcm.chunkCount - 1;
    await pcm.ensure(last);
    const chunk = pcm.get(last)!;
    expect(chunk.left[chunk.left.length - 1]).toBe(0);
    expectOnTimeline(pcm, last, 1105);
  });

  it('does not decode a chunk that is exact, and shares one decode between callers asking at once', async () => {
    const deps = fakeDecoder();
    const pcm = await open(deps);
    await Promise.all([pcm.ensure(2), pcm.ensure(2), pcm.ensure(2)]);
    const afterFirst = deps.calls.length;
    await pcm.ensure(2);
    expect(deps.calls).toHaveLength(afterFirst);
  });

  it('marks a chunk that fails to decode as failed without stopping the others', async () => {
    const deps = fakeDecoder({ fail: (call) => call === 3 });
    const pcm = await open(deps);
    await pcm.ensure(1); // calls 1 (calibrate) and 2
    await pcm.ensure(2); // call 3 fails
    await pcm.ensure(3);
    expect(pcm.chunkState(2)).toBe('failed');
    expect(pcm.chunkState(3)).toBe('exact');
    expect(pcm.get(2)).toBeNull();
  });

  it('keeps to the budget by releasing the least recently used chunk outside the focus', async () => {
    const pcm = await open(fakeDecoder(), { budgetSeconds: 30 });
    pcm.setFocus([4]);
    for (const i of [1, 2, 3]) await pcm.ensure(i); // chunk 0 comes with the calibration: 0, 1, 2 fill the budget
    pcm.get(1);
    await pcm.ensure(4);
    const exact = pcm.chunkStates().flatMap((s, i) => (s === 'exact' ? [i] : []));
    expect(exact).toContain(4);
    expect(exact.length).toBeLessThanOrEqual(3);
    expect(pcm.chunkState(1)).toBe('exact');
  });

  it('never releases a chunk in the focus, even over the budget', async () => {
    const pcm = await open(fakeDecoder(), { budgetSeconds: 20 });
    pcm.setFocus([0, 1, 2]);
    for (const i of [1, 2]) await pcm.ensure(i);
    expect(pcm.chunkStates().slice(0, 3)).toEqual(['exact', 'exact', 'exact']);
  });

  it('tells listeners when a chunk changes state, and stops after release', async () => {
    const pcm = await open(fakeDecoder());
    let changes = 0;
    pcm.onChange(() => (changes += 1));
    await pcm.ensure(1);
    expect(changes).toBeGreaterThanOrEqual(3);
    pcm.release();
    expect(pcm.chunkStates().every((s) => s === 'not-yet')).toBe(true);
    const before = changes;
    await pcm.ensure(2);
    expect(changes).toBe(before + 0);
  });

  it('reads a stretch across a chunk boundary as float samples on the timeline, decoding what is missing', async () => {
    const pcm = await open(fakeDecoder({ trim: 1105 }));
    const audio = (await pcm.read(9.99, 10.01))!;
    expect(audio.sampleRate).toBe(RATE);
    const from = Math.round(9.99 * RATE);
    expect(audio.left).toHaveLength(Math.round(10.01 * RATE) - from);
    for (const k of [0, 10, 440, audio.left.length - 1]) {
      expect(Math.round(((audio.left[k]) / 0.9) * 1000) % 1000).toBe((from + k + 1105) % 1000);
    }
  });

  it('reads nothing when the stretch is longer than the budget', async () => {
    const pcm = await open(fakeDecoder(), { budgetSeconds: 20 });
    expect(await pcm.read(0, 40)).toBeNull();
  });
});

describe('RecordingPcm of another format', () => {
  const notMp3 = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, ...new Array(100).fill(0)])]);
  const whole = (seconds: number): PcmAudio => {
    const samples = new Float32Array(seconds * 48000).fill(0.25);
    return { left: samples, right: samples, sampleRate: 48000 };
  };

  it('decodes the file whole, once, and has every chunk exact', async () => {
    let calls = 0;
    const deps: PcmDeps = { decode: async () => (calls += 1, whole(25)) };
    const result = await RecordingPcm.open(notMp3, 25, deps);
    if (result.kind !== 'ready') throw new Error('expected a store');
    expect(result.pcm.byRegion).toBe(false);
    expect(result.pcm.complete).toBe(true);
    expect(result.pcm.sampleRate).toBe(48000);
    expect(calls).toBe(1);
    await result.pcm.ensure(1);
    expect(calls).toBe(1);
    expect(result.pcm.get(1)!.left[5]).toBe(Math.round(0.25 * 32767));
  });

  it('is not possible when it is longer than the budget, and does not decode it', async () => {
    let calls = 0;
    const deps: PcmDeps = { decode: async () => (calls += 1, whole(1)) };
    const result = await RecordingPcm.open(notMp3, 1500, deps);
    expect(result).toEqual({ kind: 'not-possible', reason: 'too-long' });
    expect(calls).toBe(0);
  });

  it('is not possible when it cannot be decoded', async () => {
    const deps: PcmDeps = {
      decode: async () => {
        throw new Error('bad');
      },
    };
    expect(await RecordingPcm.open(notMp3, 25, deps)).toEqual({ kind: 'not-possible', reason: 'undecodable' });
  });
});

describe('RecordingPcm.open on files the frame map cannot be trusted for', () => {
  const wholeDecoder = (seconds: number): PcmDeps => ({
    decode: async () => {
      const samples = new Float32Array(seconds * 48000).fill(0.1);
      return { left: samples, right: samples, sampleRate: 48000 };
    },
  });

  it('decodes a recording whole when its frame map stops well short of its length, instead of marking a silent tail exact', async () => {
    const bytes = stream(FRAMES, false);
    const seconds = (FRAMES * SPF) / RATE;
    const result = await RecordingPcm.open(new Blob([bytes.buffer as ArrayBuffer]), seconds + 30, wholeDecoder(seconds + 30));
    if (result.kind !== 'ready') throw new Error('expected a store');
    expect(result.pcm.byRegion).toBe(false);
    expect(result.pcm.complete).toBe(true);
  });

  it('says too long when a recording whose frame map falls short is also over the budget', async () => {
    const bytes = stream(FRAMES, false);
    const result = await RecordingPcm.open(new Blob([bytes.buffer as ArrayBuffer]), 900, wholeDecoder(1), { budgetSeconds: 600 });
    expect(result).toEqual({ kind: 'not-possible', reason: 'too-long' });
  });

  it('still reads a recording whose map is within a second of its length by region', async () => {
    const bytes = stream(FRAMES, false);
    const seconds = (FRAMES * SPF) / RATE;
    const result = await RecordingPcm.open(new Blob([bytes.buffer as ArrayBuffer]), seconds + 0.5, wholeDecoder(1));
    if (result.kind !== 'ready') throw new Error('expected a store');
    expect(result.pcm.byRegion).toBe(true);
  });

  it('refuses a long non-MP3 recording without reading the whole file', async () => {
    const file = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, ...new Array(200000).fill(7)])]);
    let reads = 0;
    const whole = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => {
      reads += 1;
      return whole();
    };
    const result = await RecordingPcm.open(file, 1500, wholeDecoder(1));
    expect(result).toEqual({ kind: 'not-possible', reason: 'too-long' });
    expect(reads).toBe(0);
  });

  it('does not refuse a long MP3, even one with a large tag before its audio, though it is over the budget', async () => {
    // an ID3 tag whose body is 70000 bytes (sync-safe size bytes 0, 4, 0x22, 0x70), then 400 frames, about 10.4 s
    const tag = [0x49, 0x44, 0x33, 3, 0, 0, 0, 4, 0x22, 0x70, ...new Array(70000).fill(0)];
    const file = new Blob([Uint8Array.from([...tag, ...Array.from(stream(400, false))])]);
    const result = await RecordingPcm.open(file, (400 * SPF) / RATE, wholeDecoder(1), { budgetSeconds: 5 });
    expect(result.kind).toBe('ready');
    if (result.kind === 'ready') expect(result.pcm.byRegion).toBe(true);
  });
});
