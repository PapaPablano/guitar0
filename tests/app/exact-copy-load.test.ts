import { describe, expect, it, vi } from 'vitest';
import { startExactCopy, type CopyState, type CopyTarget, type ExactCopyLoadDeps, type ExactSession } from '../../src/app/exact-copy-load';
import type { ExactGate } from '../../src/audio/exact-copy';
import { RecordingPcm, type OpenResult } from '../../src/audio/recording-pcm';
import type { AudioLike } from '../../src/audio/user-audio';
import { FRAMES, RATE, SPF, fakeDecoder, stream } from '../audio/mp3-fixture';

const SECONDS = (FRAMES * SPF) / RATE;

function audio(duration = SECONDS): AudioLike {
  return { currentTime: 0, playbackRate: 1, preservesPitch: false, paused: true, ended: false, duration, async play() {}, pause() {} };
}

function clockFor() {
  return {
    element: audio(),
    offerElement: vi.fn(),
    setAdoptListener: vi.fn(),
    setGate: vi.fn(),
  } satisfies CopyTarget;
}

const flush = async (times = 40) => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 2));
};

const mp3 = () => new File([stream(FRAMES, false).buffer as ArrayBuffer], 'song.mp3', { type: 'audio/mpeg' });
const wav = () => new File(['RIFF'], 'song.wav', { type: 'audio/wav' });

function deps(open: ExactCopyLoadDeps['open']): ExactCopyLoadDeps & { made: string[]; revoked: string[] } {
  const made: string[] = [];
  const revoked: string[] = [];
  return {
    made,
    revoked,
    open,
    copy: {
      createUrl: () => {
        made.push(`blob:${made.length + 1}`);
        return made[made.length - 1];
      },
      revokeUrl: (url) => {
        revoked.push(url);
      },
      makeElement: async () => audio(),
    },
    followMs: 10,
  };
}

const openMp3 = (file: File): Promise<OpenResult> =>
  RecordingPcm.open(file, SECONDS, fakeDecoder(), { chunkSeconds: 1 });

describe('startExactCopy', () => {
  it('is preparing at first, then offers a copy to the clock with the part being played, and lets jumps ask it', async () => {
    const clock = clockFor();
    const states: CopyState[] = [];
    const file = mp3();
    startExactCopy(file, clock, (s) => states.push(s), deps(() => openMp3(file)));
    expect(states).toEqual(['preparing']);
    await flush();
    expect(clock.offerElement).toHaveBeenCalled();
    expect(clock.setGate).toHaveBeenCalledWith(expect.objectContaining({ covers: expect.any(Function), prepare: expect.any(Function) }));
    expect(clock.setAdoptListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it('says exact once all of the recording is exact', async () => {
    const clock = clockFor();
    const states: CopyState[] = [];
    const file = mp3();
    startExactCopy(file, clock, (s) => states.push(s), deps(() => openMp3(file)));
    await flush(80);
    expect(states[states.length - 1]).toBe('exact');
    expect(states).not.toContain('failed');
  });

  it('says partial while only part of a long recording can be kept exact', async () => {
    const clock = clockFor();
    const states: CopyState[] = [];
    const file = mp3();
    startExactCopy(file, clock, (s) => states.push(s), deps(() => RecordingPcm.open(file, SECONDS, fakeDecoder(), { chunkSeconds: 1, budgetSeconds: 10 })));
    await flush(80);
    expect(states[states.length - 1]).toBe('partial');
  });

  it('hands the page the shared store, and takes it back when stopped', async () => {
    const clock = clockFor();
    const sessions: (ExactSession | null)[] = [];
    const file = mp3();
    const stop = startExactCopy(file, clock, undefined, deps(() => openMp3(file)), (s) => sessions.push(s));
    await flush();
    expect(sessions[0]?.pcm.chunkCount).toBeGreaterThan(1);
    stop();
    expect(sessions[sessions.length - 1]).toBeNull();
    expect(clock.setGate).toHaveBeenLastCalledWith(null);
  });

  it('is exact straight away for a WAV, which seeks exactly already, and offers nothing', async () => {
    const clock = clockFor();
    const states: CopyState[] = [];
    const file = wav();
    startExactCopy(
      file,
      clock,
      (s) => states.push(s),
      deps(async () => RecordingPcm.open(file, 5, { decode: async () => ({ left: new Float32Array(5 * 48000), right: new Float32Array(5 * 48000), sampleRate: 48000 }) })),
    );
    await flush();
    expect(states).toEqual(['preparing', 'exact']);
    expect(clock.offerElement).not.toHaveBeenCalled();
    expect(clock.setGate).not.toHaveBeenCalledWith(expect.anything());
  });

  it('says so when the recording is too long for a copy, or cannot be decoded, and leaves the clock alone', async () => {
    for (const [reason, state] of [['too-long', 'too-long'], ['undecodable', 'failed']] as const) {
      const clock = clockFor();
      const states: CopyState[] = [];
      startExactCopy(mp3(), clock, (s) => states.push(s), deps(async () => ({ kind: 'not-possible', reason })));
      await flush(5);
      expect(states).toEqual(['preparing', state]);
      expect(clock.offerElement).not.toHaveBeenCalled();
      expect(clock.setGate).not.toHaveBeenCalledWith(expect.anything());
    }
  });

  it('a WAV that cannot be kept decoded is still exact for seeking', async () => {
    const states: CopyState[] = [];
    startExactCopy(wav(), clockFor(), (s) => states.push(s), deps(async () => ({ kind: 'not-possible', reason: 'too-long' })));
    await flush(5);
    expect(states).toEqual(['preparing', 'exact']);
  });

  it('says nothing, offers nothing and gives up the copies when the recording is replaced first', async () => {
    const clock = clockFor();
    const states: CopyState[] = [];
    const file = mp3();
    const d = deps(() => openMp3(file));
    const stop = startExactCopy(file, clock, (s) => states.push(s), d);
    stop();
    await flush();
    expect(states).toEqual(['preparing']);
    expect(clock.offerElement).not.toHaveBeenCalled();
    expect(d.made).toEqual(d.revoked);
  });

  it('asks the store to open with the length of the recording from its audio element', async () => {
    const clock = clockFor();
    const open = vi.fn(async (): Promise<OpenResult> => ({ kind: 'not-possible', reason: 'undecodable' }));
    startExactCopy(mp3(), clock, undefined, deps(open));
    await flush(3);
    expect(open).toHaveBeenCalledWith(expect.any(File), SECONDS);
  });
});

describe('the gate the clock is given', () => {
  it('is the one object that says which element has which part', async () => {
    const clock = clockFor();
    const file = mp3();
    startExactCopy(file, clock, undefined, deps(() => openMp3(file)));
    await flush();
    const gate = clock.setGate.mock.calls[0][0] as ExactGate;
    const offered = clock.offerElement.mock.calls[0][0] as AudioLike;
    expect(gate.owns(offered)).toBe(true);
    expect(gate.owns(audio())).toBe(false);
  });
});
