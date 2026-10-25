import { describe, expect, it, vi } from 'vitest';
import { CHECK_VERSION, readCaptureCheck, writeCaptureCheck, type CheckResult } from '../../src/app/capture-check-setting';
import type { ProfileStorage } from '../../src/audio/profile-store-web';
import { createCaptureFlow, type CheckRun, type FlowDeps, type FlowState } from '../../src/export/capture-check-flow';
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
