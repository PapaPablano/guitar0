import { describe, expect, it } from 'vitest';
import { pickRecorderMime, recordingFilename, recordModeOffered, recordProgress } from '../../src/export/record-capture';

describe('recordModeOffered', () => {
  const all = { videoAttached: true, source: 'original' as const, canCapture: true };

  it('is offered with a video attached, Original on, and a browser that can capture', () => {
    expect(recordModeOffered(all)).toBe(true);
  });

  it('is not offered without a video, with Synth, or where capture is unavailable', () => {
    expect(recordModeOffered({ ...all, videoAttached: false })).toBe(false);
    expect(recordModeOffered({ ...all, source: 'synth' })).toBe(false);
    expect(recordModeOffered({ ...all, canCapture: false })).toBe(false);
  });
});

describe('pickRecorderMime', () => {
  it('prefers mp4, which the desktop save accepts, then webm', () => {
    expect(pickRecorderMime(() => true)).toMatch(/^video\/mp4/);
    expect(pickRecorderMime((t) => t.startsWith('video/webm'))).toMatch(/^video\/webm/);
  });

  it('is null when the recorder supports none', () => {
    expect(pickRecorderMime(() => false)).toBeNull();
  });
});

describe('recordingFilename', () => {
  it('uses the song title and the container the recorder produced', () => {
    expect(recordingFilename('Cliffs Of Dover', 'video/mp4')).toBe('Cliffs-Of-Dover-highway-recording.mp4');
    expect(recordingFilename('Cliffs Of Dover', 'video/webm')).toBe('Cliffs-Of-Dover-highway-recording.webm');
  });

  it('falls back to "tab" for a title with nothing usable', () => {
    expect(recordingFilename('  ??  ', 'video/mp4')).toBe('tab-highway-recording.mp4');
  });
});

describe('recordProgress', () => {
  it('is the played fraction, clamped, with the recording done at the end of the tab', () => {
    expect(recordProgress(30, 120)).toEqual({ fraction: 0.25, done: false });
    expect(recordProgress(119.95, 120).done).toBe(true);
    expect(recordProgress(119.95, 120).fraction).toBeCloseTo(1, 2);
    expect(recordProgress(500, 120)).toEqual({ fraction: 1, done: true });
    expect(recordProgress(-3, 120)).toEqual({ fraction: 0, done: false });
  });

  it('is done at once for an empty tab', () => {
    expect(recordProgress(0, 0)).toEqual({ fraction: 1, done: true });
  });
});
