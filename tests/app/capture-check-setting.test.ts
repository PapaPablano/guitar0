import { describe, expect, it } from 'vitest';
import {
  CAPTURE_CHECK_KEY,
  CHECK_VERSION,
  differsFromShare,
  isStale,
  readCaptureCheck,
  writeCaptureCheck,
  type CheckResult,
} from '../../src/app/capture-check-setting';
import type { ProfileStorage } from '../../src/audio/profile-store-web';
import type { StreamInspection } from '../../src/export/record-capture';

function memory(initial: Record<string, string> = {}): ProfileStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

const hostile: ProfileStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

const tabResult: CheckResult = {
  v: CHECK_VERSION,
  at: '2026-10-25T14:00:00.000Z',
  captureWorks: true,
  outcome: 'clean',
  surface: 'browser',
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48000,
  lines: ['The test sound came through unchanged.'],
  mime: 'video/webm;codecs=vp9,opus',
  audioBitsPerSecond: 192000,
};

const tabShare: StreamInspection = {
  hasAudio: true,
  audioLive: true,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  sampleRate: 48000,
  channelCount: 2,
  surface: 'browser',
};

describe('the remembered capture check', () => {
  it('reads as no result when nothing has been saved', () => {
    expect(readCaptureCheck(memory())).toBeNull();
  });

  it('round trips a result, including the chosen container and audio bitrate', () => {
    const storage = memory();
    writeCaptureCheck(tabResult, storage);
    expect(readCaptureCheck(storage)).toEqual(tabResult);
  });

  it('reads a result with no container field as the default order', () => {
    const storage = memory();
    const { mime: _mime, audioBitsPerSecond: _bits, ...rest } = tabResult;
    storage.setItem(CAPTURE_CHECK_KEY, JSON.stringify(rest));
    const read = readCaptureCheck(storage);
    expect(read).not.toBeNull();
    expect(read!.mime).toBeNull();
    expect(read!.audioBitsPerSecond).toBeNull();
  });

  it('reads junk, an old version and missing fields as no result, without throwing', () => {
    for (const junk of ['', 'maybe', '[]', '{"x":1}', 'null', '{"v":0}', JSON.stringify({ ...tabResult, v: CHECK_VERSION + 1 }), JSON.stringify({ ...tabResult, surface: 'galaxy' })]) {
      expect(readCaptureCheck(memory({ [CAPTURE_CHECK_KEY]: junk }))).toBeNull();
    }
  });

  it('never throws when storage is missing or blocked on read or write', () => {
    expect(readCaptureCheck(null)).toBeNull();
    expect(readCaptureCheck(hostile)).toBeNull();
    expect(() => writeCaptureCheck(tabResult, hostile)).not.toThrow();
    expect(() => writeCaptureCheck(tabResult, null)).not.toThrow();
  });
});

describe('isStale', () => {
  it('is stale when the sample rate changed, and not when it is the same', () => {
    expect(isStale(tabResult, 44100)).toBe(true);
    expect(isStale(tabResult, 48000)).toBe(false);
  });

  it('is not stale when the current rate is unknown', () => {
    expect(isStale(tabResult, null)).toBe(false);
  });
});

describe('differsFromShare', () => {
  it('covers AE6: a stored tab result and a whole-screen share differ', () => {
    expect(differsFromShare(tabResult, { ...tabShare, surface: 'monitor' })).toBe(true);
  });

  it('does not differ for the same surface and processing', () => {
    expect(differsFromShare(tabResult, tabShare)).toBe(false);
  });

  it('differs when a processing stage is now active that was off', () => {
    expect(differsFromShare(tabResult, { ...tabShare, noiseSuppression: true })).toBe(true);
  });

  it('differs when audio is now missing from a share that had it, and when it is now present after none', () => {
    expect(differsFromShare(tabResult, { ...tabShare, hasAudio: false, audioLive: false })).toBe(true);
    expect(differsFromShare({ ...tabResult, outcome: 'no-audio' }, tabShare)).toBe(true);
  });

  it('ignores a flag the browser does not report', () => {
    expect(differsFromShare(tabResult, { ...tabShare, echoCancellation: null })).toBe(false);
  });
});
