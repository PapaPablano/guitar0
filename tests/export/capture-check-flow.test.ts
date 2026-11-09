import { describe, expect, it, vi } from 'vitest';
import { CHECK_VERSION, readCaptureCheck, writeCaptureCheck, type CheckResult } from '../../src/app/capture-check-setting';
import type { ProfileStorage } from '../../src/audio/profile-store-web';
import { createCaptureFlow, shareLine, weaknessLines, type CheckRun, type FlowDeps, type FlowState } from '../../src/export/capture-check-flow';
import type { CaptureSession, StreamInspection } from '../../src/export/record-capture';

function memory(): ProfileStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

/** A share with a video track whose `ended` listener the test can fire, and two tracks to see stopped. */
function fakeShare() {
  const listeners: Array<() => void> = [];
  const video = { stop: vi.fn(), addEventListener: (_: string, l: () => void) => void listeners.push(l) };
  const audio = { stop: vi.fn(), addEventListener: () => undefined };
  const stream = { getTracks: () => [audio, video], getVideoTracks: () => [video], getAudioTracks: () => [audio] } as unknown as MediaStream;
  return { stream, tracks: [audio, video], end: () => listeners.forEach((l) => l()) };
}

const tabShare: StreamInspection = { hasAudio: true, audioLive: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false, sampleRate: 48000, channelCount: 2, surface: 'browser' };

const cleanRun: CheckRun = {
  report: { verdict: 'clean', effects: [], latencySeconds: 0.1, aligned: true },
  chosen: { mime: 'video/webm;codecs=vp9,opus', audioBitsPerSecond: 192_000 },
  encoderSkipped: false,
  heard: { samples: new Float32Array(10), sampleRate: 48000 },
};

const session: CaptureSession = { mime: 'video/webm', stop: async () => new Blob(), cancel: vi.fn() };

function setup(overrides: Partial<FlowDeps> = {}, shareInspection: StreamInspection = tabShare) {
  const share = fakeShare();
  const storage = memory();
  const calls: string[] = [];
  let clock = 0;
  const deps: FlowDeps = {
    acquire: vi.fn(async () => {
      calls.push('acquire');
      return share.stream;
    }),
    inspect: vi.fn(() => shareInspection),
    runCheck: vi.fn(async () => {
      calls.push('check');
      return cleanRun;
    }),
    startRecorder: vi.fn(() => {
      calls.push('record');
      return session;
    }),
    storage,
    currentSampleRate: () => 48000,
    now: () => `2026-10-25T14:00:0${clock++}.000Z`,
    ...overrides,
  };
  const states: FlowState[] = [];
  const hooks = { onState: (s: FlowState) => void states.push(s), onRecording: vi.fn(), onShareEnded: vi.fn() };
  const flow = createCaptureFlow(deps, hooks);
  return { flow, deps, hooks, share, storage, calls, states };
}

const storedTabResult = (patch: Partial<CheckResult> = {}): CheckResult => ({
  v: CHECK_VERSION,
  at: '2026-10-24T10:00:00.000Z',
  captureWorks: true,
  outcome: 'clean',
  surface: 'browser',
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48000,
  lines: ['The test sound came through unchanged.'],
  mime: null,
  audioBitsPerSecond: null,
  ...patch,
});

describe('the capture check flow', () => {
  it('covers AE1: with no stored result it shares once, checks, stores the result, and only then starts the long recorder', async () => {
    const { flow, deps, hooks, calls, storage } = setup();
    await flow.start('record');
    expect(calls).toEqual(['acquire', 'check', 'record']);
    expect(deps.acquire).toHaveBeenCalledTimes(1);
    expect(readCaptureCheck(storage)?.outcome).toBe('clean');
    expect(hooks.onRecording).toHaveBeenCalledWith(session);
    expect(flow.state().name).toBe('recording');
  });

  it('uses the container the check chose for the long recording, and the stored one on a later recording', async () => {
    const first = setup();
    await first.flow.start('record');
    expect(first.deps.startRecorder).toHaveBeenCalledWith(first.share.stream, { mime: 'video/webm;codecs=vp9,opus', audioBitsPerSecond: 192_000 });

    const later = setup();
    writeCaptureCheck(storedTabResult({ mime: 'video/webm;codecs=vp9,opus', audioBitsPerSecond: 256_000 }), later.storage);
    await later.flow.start('record');
    expect(later.deps.runCheck).not.toHaveBeenCalled();
    expect(later.deps.startRecorder).toHaveBeenCalledWith(later.share.stream, { mime: 'video/webm;codecs=vp9,opus', audioBitsPerSecond: 256_000 });
  });

  it('starts a later recording with the default order when the stored result chose nothing', async () => {
    const { flow, deps, storage, share } = setup();
    writeCaptureCheck(storedTabResult(), storage);
    await flow.start('record');
    expect(deps.startRecorder).toHaveBeenCalledWith(share.stream, { mime: undefined, audioBitsPerSecond: undefined });
  });

  it('covers AE6: a stored tab result and a whole-screen share warn again, with no test sound and no recording', async () => {
    const { flow, deps, storage } = setup({}, { ...tabShare, surface: 'monitor' });
    writeCaptureCheck(storedTabResult(), storage);
    await flow.start('record');
    expect(deps.runCheck).not.toHaveBeenCalled();
    expect(deps.startRecorder).not.toHaveBeenCalled();
    const state = flow.state();
    expect(state.name).toBe('report');
    if (state.name === 'report') {
      expect(state.variant).toBe('before-recording');
      expect(state.result.lines.join(' ')).toMatch(/whole screen/i);
    }
  });

  it('covers AE5: Re-check runs the check, never starts the long recorder, replaces the stored result and stops the share', async () => {
    const { flow, deps, storage, share } = setup();
    writeCaptureCheck(storedTabResult({ at: 'old' }), storage);
    await flow.start('recheck');
    expect(deps.runCheck).toHaveBeenCalledTimes(1);
    expect(deps.startRecorder).not.toHaveBeenCalled();
    expect(readCaptureCheck(storage)?.at).not.toBe('old');
    for (const t of share.tracks) expect(t.stop).toHaveBeenCalled();
    const state = flow.state();
    expect(state.name === 'report' && state.variant).toBe('check-only');
    expect(flow.heardSound()).not.toBeNull();
  });

  it('ignores a second start while one is in flight, so no second picker opens', async () => {
    let resolveAcquire: (s: MediaStream) => void = () => undefined;
    const share = fakeShare();
    const { flow, deps } = setup({ acquire: vi.fn(() => new Promise<MediaStream>((r) => (resolveAcquire = r))) });
    const first = flow.start('record');
    await flow.start('record');
    resolveAcquire(share.stream);
    await first;
    expect(deps.acquire).toHaveBeenCalledTimes(1);
  });

  it('returns to idle and stores nothing when the player cancels the picker', async () => {
    const { flow, storage } = setup({ acquire: vi.fn(async () => Promise.reject(domError('NotAllowedError'))) });
    await flow.start('record');
    expect(flow.state().name).toBe('idle');
    expect(readCaptureCheck(storage)).toBeNull();
  });

  it('stores that capture does not work once, and reports it, when the shell cannot capture', async () => {
    const { flow, storage } = setup({ acquire: vi.fn(async () => Promise.reject(domError('NotSupportedError'))) });
    await flow.start('record');
    expect(flow.state().name).toBe('failed');
    const first = readCaptureCheck(storage);
    expect(first?.captureWorks).toBe(false);
    await flow.start('record');
    expect(readCaptureCheck(storage)?.at).toBe(first?.at);
  });

  it('aborts when the share ends during the check: nothing stored, the long recorder never starts', async () => {
    let finishCheck: (r: CheckRun) => void = () => undefined;
    const { flow, deps, share, storage } = setup({ runCheck: vi.fn(() => new Promise<CheckRun>((r) => (finishCheck = r))) });
    const running = flow.start('record');
    await Promise.resolve();
    await Promise.resolve();
    share.end();
    finishCheck(cleanRun);
    await running;
    const state = flow.state();
    expect(state.name === 'failed' && state.reason).toMatch(/share ended/i);
    expect(deps.startRecorder).not.toHaveBeenCalled();
    expect(readCaptureCheck(storage)).toBeNull();
  });

  it('releases the tracks and returns to idle on Stop during the check', async () => {
    let finishCheck: (r: CheckRun) => void = () => undefined;
    const { flow, deps, share, storage } = setup({ runCheck: vi.fn(() => new Promise<CheckRun>((r) => (finishCheck = r))) });
    const running = flow.start('record');
    await Promise.resolve();
    await Promise.resolve();
    flow.abort();
    finishCheck(cleanRun);
    await running;
    expect(flow.state().name).toBe('idle');
    for (const t of share.tracks) expect(t.stop).toHaveBeenCalled();
    expect(deps.startRecorder).not.toHaveBeenCalled();
    expect(readCaptureCheck(storage)).toBeNull();
  });

  it('skips the check and reports that no sound came with the share, still allowing the recording', async () => {
    const { flow, deps } = setup({}, { ...tabShare, hasAudio: false, audioLive: false });
    await flow.start('record');
    expect(deps.runCheck).not.toHaveBeenCalled();
    const state = flow.state();
    expect(state.name === 'report' && state.result.outcome).toBe('no-audio');
    flow.proceed();
    expect(deps.startRecorder).toHaveBeenCalledTimes(1);
    expect(deps.acquire).toHaveBeenCalledTimes(1);
  });

  it('warns on an altered result, keeps what was heard, and Record anyway starts the long recorder on the same share', async () => {
    const altered: CheckRun = { ...cleanRun, report: { verdict: 'altered', effects: [{ kind: 'lost-highs', measured: -20 }], latencySeconds: 0, aligned: true } };
    const { flow, deps, share } = setup({ runCheck: vi.fn(async () => altered) });
    await flow.start('record');
    const state = flow.state();
    expect(state.name === 'report' && state.variant).toBe('before-recording');
    expect(state.name === 'report' && state.canHear).toBe(true);
    expect(deps.startRecorder).not.toHaveBeenCalled();
    flow.proceed();
    expect(deps.startRecorder).toHaveBeenCalledWith(share.stream, expect.anything());
    expect(deps.acquire).toHaveBeenCalledTimes(1);
  });

  it('notes in the result that the encoder was not measured when the second recorder was refused', async () => {
    const skipped: CheckRun = { ...cleanRun, chosen: {}, encoderSkipped: true };
    const { flow, storage } = setup({ runCheck: vi.fn(async () => skipped) });
    await flow.start('record');
    expect(readCaptureCheck(storage)?.lines.join(' ')).toMatch(/encoder was not measured/i);
  });

  it('tells the page when the share ends during the long recording', async () => {
    const { flow, hooks, share } = setup();
    await flow.start('record');
    share.end();
    expect(hooks.onShareEnded).toHaveBeenCalledTimes(1);
  });

  it('a share still applying processing warns even if the sound compared clean', async () => {
    const { flow } = setup({}, { ...tabShare, noiseSuppression: true });
    await flow.start('record');
    expect(flow.state().name).toBe('report');
  });

  it('allows a new start after the recording finishes', async () => {
    const { flow, deps } = setup();
    await flow.start('record');
    flow.finished();
    expect(flow.state().name).toBe('idle');
    await flow.start('record');
    expect(deps.acquire).toHaveBeenCalledTimes(2);
  });
});

const alteredRun: CheckRun = { ...cleanRun, report: { verdict: 'altered', effects: [{ kind: 'lost-highs', measured: -20 }], latencySeconds: 0, aligned: true } };

describe('the capture check flow, failure and restart paths', () => {
  it('fails, stops the share and stores nothing when the check itself throws', async () => {
    const { flow, share, storage } = setup({ runCheck: vi.fn(async () => Promise.reject(new Error('The test sound did not play.'))) });
    await flow.start('record');
    const state = flow.state();
    expect(state.name === 'failed' && state.reason).toMatch(/did not play/);
    for (const t of share.tracks) expect(t.stop).toHaveBeenCalled();
    expect(readCaptureCheck(storage)).toBeNull();
  });

  it('fails with the mapped reason when the long recorder cannot start', async () => {
    const { flow } = setup({
      startRecorder: vi.fn(() => {
        throw domError('NotSupportedError');
      }),
    });
    await flow.start('record');
    const state = flow.state();
    expect(state.name === 'failed' && state.reason).toMatch(/cannot capture/i);
  });

  it('checks again when the machine audio rate changed since the stored result', async () => {
    const { flow, deps, storage } = setup();
    writeCaptureCheck(storedTabResult({ sampleRate: 44100 }), storage);
    await flow.start('record');
    expect(deps.runCheck).toHaveBeenCalledTimes(1);
  });

  it('runs the full check again when the stored result says capture did not work', async () => {
    const { flow, deps, storage } = setup();
    writeCaptureCheck(storedTabResult({ captureWorks: false, outcome: 'failed' }), storage);
    await flow.start('record');
    expect(deps.runCheck).toHaveBeenCalledTimes(1);
  });

  it('runs the check again, not just a warning, when a stored result found no sound and the share now has some', async () => {
    const { flow, deps, storage } = setup();
    writeCaptureCheck(storedTabResult({ outcome: 'no-audio' }), storage);
    await flow.start('record');
    expect(deps.runCheck).toHaveBeenCalledTimes(1);
    expect(readCaptureCheck(storage)?.outcome).toBe('clean');
  });

  it('warns again, with the stored findings, on a repeat of a share that was already found weak', async () => {
    const { flow, deps, storage } = setup();
    writeCaptureCheck(storedTabResult({ outcome: 'altered', lines: ['Highs were cut by 20 dB against the middle of the sound, which makes it muffled.'] }), storage);
    await flow.start('record');
    expect(deps.startRecorder).not.toHaveBeenCalled();
    expect(deps.runCheck).not.toHaveBeenCalled();
    const state = flow.state();
    expect(state.name === 'report' && state.weak).toBe(true);
    expect(state.name === 'report' && state.result.lines[0]).toMatch(/Highs were cut/);
  });

  it('warns when the stored result was clean but the new share still applies processing', async () => {
    const { flow, deps, storage } = setup({}, { ...tabShare, autoGainControl: true });
    writeCaptureCheck(storedTabResult(), storage);
    await flow.start('record');
    const state = flow.state();
    expect(state.name === 'report' && state.weak).toBe(true);
    expect(deps.startRecorder).not.toHaveBeenCalled();
  });

  it('ends with a failure when the share ends while a warning waits for Record anyway', async () => {
    const { flow, deps, share } = setup({ runCheck: vi.fn(async () => alteredRun) });
    await flow.start('record');
    share.end();
    const state = flow.state();
    expect(state.name === 'failed' && state.reason).toMatch(/share ended/i);
    flow.proceed();
    expect(deps.startRecorder).not.toHaveBeenCalled();
  });

  it('marks a clean Re-check as not weak and an altered one as weak', async () => {
    const clean = setup();
    await clean.flow.start('recheck');
    const cleanState = clean.flow.state();
    expect(cleanState.name === 'report' && cleanState.weak).toBe(false);

    const weak = setup({ runCheck: vi.fn(async () => alteredRun) });
    await weak.flow.start('recheck');
    const weakState = weak.flow.state();
    expect(weakState.name === 'report' && weakState.weak).toBe(true);
  });

  it('lets Record start again straight after a Re-check report, instead of doing nothing until Close', async () => {
    const { flow, deps } = setup();
    await flow.start('recheck');
    expect(flow.state().name).toBe('report');
    await flow.start('record');
    expect(deps.acquire).toHaveBeenCalledTimes(2);
    expect(flow.state().name).toBe('recording');
  });

  it('replaces a warning that is still showing when Record is pressed again', async () => {
    const first = fakeShare();
    const second = fakeShare();
    const acquire = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    const { flow, deps } = setup({ acquire, runCheck: vi.fn().mockResolvedValueOnce(alteredRun) });
    await flow.start('record');
    expect(flow.state().name).toBe('report');
    await flow.start('record');
    // The first share is released and a fresh one is asked for; the remembered weak result warns again without a new test.
    for (const t of first.tracks) expect(t.stop).toHaveBeenCalled();
    expect(deps.acquire).toHaveBeenCalledTimes(2);
    expect(deps.runCheck).toHaveBeenCalledTimes(1);
    expect(flow.state().name).toBe('report');
    flow.proceed();
    expect(deps.startRecorder).toHaveBeenCalledWith(second.stream, expect.anything());
  });

  it('leaves a newer run alone when an older cancelled one finishes later', async () => {
    const first = fakeShare();
    const second = fakeShare();
    let resolveFirst: (s: MediaStream) => void = () => undefined;
    const acquire = vi
      .fn()
      .mockImplementationOnce(() => new Promise<MediaStream>((r) => (resolveFirst = r)))
      .mockImplementationOnce(async () => second.stream);
    const { flow, deps } = setup({ acquire });
    const old = flow.start('record');
    await Promise.resolve();
    flow.abort();
    await flow.start('record');
    expect(flow.state().name).toBe('recording');
    resolveFirst(first.stream);
    await old;
    for (const t of first.tracks) expect(t.stop).toHaveBeenCalled();
    for (const t of second.tracks) expect(t.stop).not.toHaveBeenCalled();
    expect(flow.state().name).toBe('recording');
    expect(deps.startRecorder).toHaveBeenCalledTimes(1);
  });
});

describe('weaknessLines', () => {
  it('names each processing stage still applied and the surface that carries other sound', () => {
    expect(weaknessLines({ ...tabShare, echoCancellation: true }).join(' ')).toMatch(/echo cancellation/i);
    expect(weaknessLines({ ...tabShare, noiseSuppression: true }).join(' ')).toMatch(/noise suppression/i);
    expect(weaknessLines({ ...tabShare, autoGainControl: true }).join(' ')).toMatch(/automatic gain/i);
    expect(weaknessLines({ ...tabShare, surface: 'window' }).join(' ')).toMatch(/window/i);
    expect(weaknessLines({ ...tabShare, surface: 'monitor' }).join(' ')).toMatch(/whole screen/i);
  });

  it('has nothing to say about a clean tab share', () => {
    expect(weaknessLines(tabShare)).toEqual([]);
  });
});

describe('shareLine', () => {
  it('covers R3: says which sound was shared and at what rate', () => {
    expect(shareLine(tabShare)).toBe("Shared: this tab's sound, 48 kHz.");
    expect(shareLine({ ...tabShare, surface: 'monitor' })).toMatch(/whole screen/);
    expect(shareLine({ ...tabShare, surface: 'unknown' })).toBe('Sample rate: 48 kHz.');
    expect(shareLine({ ...tabShare, surface: 'unknown', sampleRate: null })).toBeNull();
  });

  it('puts the line in the result of a check that ran', async () => {
    const { flow } = setup();
    await flow.start('recheck');
    const state = flow.state();
    expect(state.name === 'report' && state.result.lines).toContain("Shared: this tab's sound, 48 kHz.");
  });
});
