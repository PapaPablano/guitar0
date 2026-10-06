import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExactCopy, type ChunkRequests, type ExactCopyDeps } from '../../src/audio/exact-copy';
import { buildExactWav, wavHeader } from '../../src/audio/exact-wav';
import { RecordingPcm } from '../../src/audio/recording-pcm';
import type { AudioLike } from '../../src/audio/user-audio';
import { FRAMES, RATE, SPF, fakeDecoder, stream } from './mp3-fixture';

const SECONDS = (FRAMES * SPF) / RATE;

/** A store of the MP3 fixture in one-second chunks. */
async function store(over: { budgetSeconds?: number } = {}): Promise<RecordingPcm> {
  const bytes = stream(FRAMES, false);
  const opened = await RecordingPcm.open(new Blob([bytes.buffer as ArrayBuffer]), SECONDS, fakeDecoder(), { chunkSeconds: 1, ...over });
  if (opened.kind !== 'ready') throw new Error('expected a store');
  return opened.pcm;
}

const element = (): AudioLike => ({ currentTime: 0, playbackRate: 1, preservesPitch: false, paused: true, ended: false, duration: SECONDS, async play() {}, pause() {} });

function deps(over: { failMake?: boolean } = {}) {
  const made: string[] = [];
  const revoked: string[] = [];
  let count = 0;
  const api: ExactCopyDeps & { made: string[]; revoked: string[]; elements: AudioLike[] } = {
    made,
    revoked,
    elements: [],
    createUrl: () => {
      const url = `blob:${++count}`;
      made.push(url);
      return url;
    },
    revokeUrl: (url) => {
      revoked.push(url);
    },
    makeElement: async () => {
      if (over.failMake) throw new Error('cannot open');
      const el = element();
      api.elements.push(el);
      return el;
    },
  };
  return api;
}

/** A queue stand-in that makes the asked-for chunks exact, as the real one does. */
const requestsFor = (pcm: RecordingPcm, ok = true): ChunkRequests & { asked: [number, number | undefined][] } => ({
  asked: [],
  async request(seconds, count) {
    this.asked.push([seconds, count]);
    if (!ok) return false;
    const first = pcm.chunkAt(seconds);
    for (let i = first; i < first + (count ?? 1); i++) await pcm.ensure(i);
    return true;
  },
});

const readInt16 = async (blob: Blob): Promise<Int16Array> => new Int16Array(await blob.arrayBuffer(), 44);

describe('buildExactWav', () => {
  it('writes a header for a WAV as long as the recording', async () => {
    const pcm = await store();
    const header = wavHeader(pcm.sampleRate, Math.round(SECONDS * RATE));
    const view = new DataView(header.buffer);
    expect(String.fromCharCode(...header.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...header.slice(8, 16))).toBe('WAVEfmt ');
    expect(view.getUint32(24, true)).toBe(RATE);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(40, true)).toBe(Math.round(SECONDS * RATE) * 4);
  });

  it('is the length of the recording, with the exact chunks in place and silence between them', async () => {
    const pcm = await store();
    await pcm.ensure(2);
    await pcm.ensure(5);
    const { blob, covered } = buildExactWav(pcm);
    expect(blob.size).toBe(44 + Math.round(SECONDS * RATE) * 4);
    expect(blob.type).toBe('audio/wav');
    expect(covered.length).toBe(pcm.chunkCount);
    expect(covered.flatMap((c, i) => (c ? [i] : []))).toEqual([0, 2, 5]);
    const samples = await readInt16(blob);
    const at = (chunk: number) => chunk * pcm.chunkSamples * 2;
    const exact = pcm.get(5)!;
    expect(samples[at(5)]).toBe(exact.left[0]);
    expect(samples[at(5) + 1]).toBe(exact.right[0]);
    expect(samples[at(5) + 2 * 700]).toBe(exact.left[700]);
    for (const k of [0, 1000, 2 * pcm.chunkSamples - 1]) expect(samples[at(3) + k]).toBe(0);
  });

  it('cuts the last chunk where the recording ends', async () => {
    const pcm = await store();
    await pcm.ensure(pcm.chunkCount - 1);
    const { blob } = buildExactWav(pcm);
    expect(blob.size).toBe(44 + Math.round(SECONDS * RATE) * 4);
  });

  it('reuses a whole chunk\'s data when the next copy is built', async () => {
    const pcm = await store();
    await pcm.ensure(1);
    const first = buildExactWav(pcm);
    const second = buildExactWav(pcm);
    expect(second.covered).toEqual(first.covered);
    expect(second.blob.size).toBe(first.blob.size);
  });
});

describe('ExactCopy', () => {
  afterEach(() => vi.useRealTimers());

  it('makes a copy with the asked-for chunks and offers it, once', async () => {
    const pcm = await store();
    const d = deps();
    const offer = vi.fn();
    const copy = new ExactCopy(pcm, requestsFor(pcm), offer, d);
    expect(await copy.prepare(7.5)).toBe(true);
    expect(offer).toHaveBeenCalledTimes(1);
    const el = offer.mock.calls[0][0] as AudioLike;
    expect(copy.owns(el)).toBe(true);
    expect(copy.covers(el, 7.5, 2)).toBe(true);
    expect(copy.covers(el, 30, 1)).toBe(false);
    expect(copy.covers(element(), 7.5)).toBe(false);
    copy.stop();
  });

  it('does not make another copy for a part the latest one has', async () => {
    const pcm = await store();
    const d = deps();
    const offer = vi.fn();
    const copy = new ExactCopy(pcm, requestsFor(pcm), offer, d);
    await copy.prepare(7.5);
    await copy.prepare(7.9);
    expect(offer).toHaveBeenCalledTimes(1);
    copy.stop();
  });

  it('makes a newer copy for a part the latest lacks, one that keeps the earlier part too', async () => {
    const pcm = await store();
    const d = deps();
    const offer = vi.fn();
    const copy = new ExactCopy(pcm, requestsFor(pcm), offer, d);
    await copy.prepare(7.5);
    await copy.prepare(30);
    expect(offer).toHaveBeenCalledTimes(2);
    const [first, second] = offer.mock.calls.map((c) => c[0] as AudioLike);
    expect(copy.covers(first, 30)).toBe(false);
    expect(copy.covers(second, 30, 2)).toBe(true);
    expect(copy.covers(second, 7.5, 2)).toBe(true);
    copy.stop();
  });

  it('lets go of a copy the clock has left, and keeps the one in use and the latest', async () => {
    const pcm = await store();
    const d = deps();
    const offer = vi.fn();
    const copy = new ExactCopy(pcm, requestsFor(pcm), offer, d);
    await copy.prepare(7.5);
    const first = offer.mock.calls[0][0] as AudioLike;
    copy.adopted(first);
    await copy.prepare(30);
    expect(d.revoked).toEqual([]);
    const second = offer.mock.calls[1][0] as AudioLike;
    copy.adopted(second);
    expect(d.revoked).toEqual([d.made[0]]);
    copy.stop();
    expect(d.revoked).toContain(d.made[1]);
  });

  it('makes nothing when the chunks cannot be made exact', async () => {
    const pcm = await store();
    const d = deps();
    const offer = vi.fn();
    const copy = new ExactCopy(pcm, requestsFor(pcm, false), offer, d);
    expect(await copy.prepare(7.5)).toBe(false);
    expect(offer).not.toHaveBeenCalled();
    expect(d.made).toEqual([]);
    copy.stop();
  });

  it('gives back the url and says false when the element cannot be opened', async () => {
    const pcm = await store();
    const d = deps({ failMake: true });
    const offer = vi.fn();
    const copy = new ExactCopy(pcm, requestsFor(pcm), offer, d);
    expect(await copy.prepare(7.5)).toBe(false);
    expect(offer).not.toHaveBeenCalled();
    expect(d.revoked).toEqual(d.made);
    copy.stop();
  });

  it('makes a copy that has the new chunks as more of the recording becomes exact, after a quiet moment', async () => {
    vi.useFakeTimers();
    const pcm = await store();
    const d = deps();
    const offer = vi.fn();
    let now = 0;
    const copy = new ExactCopy(pcm, requestsFor(pcm), offer, d, () => now);
    const prepared = copy.prepare(7.5);
    await vi.advanceTimersByTimeAsync(0);
    await prepared;
    expect(offer).toHaveBeenCalledTimes(1);
    for (const i of [20, 21, 22]) await pcm.ensure(i);
    now += 1000;
    await vi.advanceTimersByTimeAsync(500);
    expect(offer).toHaveBeenCalledTimes(2);
    expect(copy.covers(offer.mock.calls[1][0] as AudioLike, 21, 1)).toBe(true);
    copy.stop();
  });

  it('offers nothing after it is stopped, even for a copy that was being made', async () => {
    const pcm = await store();
    const d = deps();
    const offer = vi.fn();
    const copy = new ExactCopy(pcm, requestsFor(pcm), offer, d);
    const prepared = copy.prepare(7.5);
    copy.stop();
    expect(await prepared).toBe(false);
    expect(offer).not.toHaveBeenCalled();
    expect(await copy.prepare(30)).toBe(false);
  });
});
