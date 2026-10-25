import { describe, expect, it, vi } from 'vitest';
import { acquireStream, containerCandidates, displayRequests, inspectStream, startRecorder } from '../../src/export/record-capture';

interface FakeTrack {
  readyState: 'live' | 'ended';
  getSettings: () => Record<string, unknown>;
  addEventListener: (type: string, listener: () => void) => void;
  stop: () => void;
}

function track(settings: Record<string, unknown> = {}, readyState: 'live' | 'ended' = 'live'): FakeTrack {
  return { readyState, getSettings: () => settings, addEventListener: () => undefined, stop: vi.fn() };
}

function fakeStream(audio: FakeTrack[], video: FakeTrack[] = [track({ displaySurface: 'browser' })]) {
  return {
    getAudioTracks: () => audio,
    getVideoTracks: () => video,
    getTracks: () => [...audio, ...video],
  } as unknown as MediaStream;
}

function domError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

describe('displayRequests', () => {
  it('asks for echo cancellation, noise suppression and automatic gain off in every attempt, current tab first', () => {
    const requests = displayRequests();
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const request of requests) {
      expect(request.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    }
    expect(requests[0]).toMatchObject({ preferCurrentTab: true, systemAudio: 'include' });
  });
});

describe('acquireStream', () => {
  it('asks the browser once and returns the stream it gives', async () => {
    const stream = fakeStream([track()]);
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    expect(await acquireStream(getDisplayMedia)).toBe(stream);
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(getDisplayMedia.mock.calls[0][0]).toMatchObject({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  });

  it('rethrows a cancelled picker without trying a plainer request', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(domError('NotAllowedError'));
    await expect(acquireStream(getDisplayMedia)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  it('tries the next plainer request after a non-permission error, and every attempt keeps the processing flags', async () => {
    const stream = fakeStream([track()]);
    const getDisplayMedia = vi.fn().mockRejectedValueOnce(domError('NotSupportedError')).mockResolvedValueOnce(stream);
    expect(await acquireStream(getDisplayMedia)).toBe(stream);
    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    for (const call of getDisplayMedia.mock.calls) expect(call[0]).toMatchObject({ audio: { echoCancellation: false } });
  });

  it('reports the last error when every request fails, and does not retry beyond the list', async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(domError('NotFoundError'));
    await expect(acquireStream(getDisplayMedia)).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(getDisplayMedia).toHaveBeenCalledTimes(displayRequests().length);
  });
});

describe('inspectStream', () => {
  it('covers AE2: reports processing still active when the track says so after the request', () => {
    const inspection = inspectStream(fakeStream([track({ echoCancellation: true, noiseSuppression: false, autoGainControl: true, sampleRate: 48000, channelCount: 2 })]));
    expect(inspection.hasAudio).toBe(true);
    expect(inspection.echoCancellation).toBe(true);
    expect(inspection.noiseSuppression).toBe(false);
    expect(inspection.autoGainControl).toBe(true);
    expect(inspection.sampleRate).toBe(48000);
    expect(inspection.channelCount).toBe(2);
  });

  it('reports no audio, without throwing, when the share has no audio track', () => {
    const inspection = inspectStream(fakeStream([]));
    expect(inspection.hasAudio).toBe(false);
    expect(inspection.audioLive).toBe(false);
    expect(inspection.echoCancellation).toBeNull();
  });

  it('reports an ended audio track as not live', () => {
    expect(inspectStream(fakeStream([track({}, 'ended')])).audioLive).toBe(false);
  });

  it('covers AE3: reads the surface the player shared', () => {
    expect(inspectStream(fakeStream([track()], [track({ displaySurface: 'monitor' })])).surface).toBe('monitor');
    expect(inspectStream(fakeStream([track()], [track({ displaySurface: 'window' })])).surface).toBe('window');
    expect(inspectStream(fakeStream([track()], [track({ displaySurface: 'browser' })])).surface).toBe('browser');
    expect(inspectStream(fakeStream([track()], [track({})])).surface).toBe('unknown');
  });
});

describe('containerCandidates', () => {
  it('gives the best supported mp4 and the best supported webm, mp4 first', () => {
    const all = () => true;
    const list = containerCandidates(all);
    expect(list[0]).toMatch(/^video\/mp4/);
    expect(list[1]).toMatch(/^video\/webm/);
  });

  it('gives only what the recorder supports, and nothing when it supports none', () => {
    expect(containerCandidates((t) => t.startsWith('video/webm'))).toHaveLength(1);
    expect(containerCandidates(() => false)).toEqual([]);
  });
});

describe('startRecorder', () => {
  class FakeRecorder {
    static last: FakeRecorder;
    state: 'inactive' | 'recording' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(
      readonly stream: unknown,
      readonly options: Record<string, unknown>,
    ) {
      FakeRecorder.last = this;
    }
    static isTypeSupported = () => true;
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      this.onstop?.();
    }
  }

  it('uses the chosen container and audio bitrate when given', () => {
    startRecorder(fakeStream([track()]), { onEnded: () => undefined }, { mime: 'video/webm;codecs=vp9,opus', audioBitsPerSecond: 256_000 }, FakeRecorder as unknown as typeof MediaRecorder);
    expect(FakeRecorder.last.options).toMatchObject({ mimeType: 'video/webm;codecs=vp9,opus', audioBitsPerSecond: 256_000 });
  });

  it('falls back to the default container order and bitrate when nothing was chosen', () => {
    const session = startRecorder(fakeStream([track()]), { onEnded: () => undefined }, {}, FakeRecorder as unknown as typeof MediaRecorder);
    expect(FakeRecorder.last.options.mimeType).toMatch(/^video\/mp4/);
    expect(FakeRecorder.last.options.audioBitsPerSecond).toBe(192_000);
    expect(session.mime).toBe('video/mp4');
  });

  it('stops every track when cancelled', () => {
    const audio = track();
    const session = startRecorder(fakeStream([audio]), { onEnded: () => undefined }, {}, FakeRecorder as unknown as typeof MediaRecorder);
    session.cancel();
    expect(audio.stop).toHaveBeenCalled();
  });
});
