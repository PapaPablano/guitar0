import { describe, expect, it } from 'vitest';
import { placeRecording } from '../../src/export/audio';

describe('placeRecording', () => {
  it('covers AE7: offset -1.5 s starts the recording 1.5 s into the output, from its beginning', () => {
    expect(placeRecording(-1.5, 20)).toEqual({ delaySeconds: 1.5, startSeconds: 0, audible: true });
  });

  it('skips the start of the recording for a positive offset, as before', () => {
    expect(placeRecording(2, 20)).toEqual({ delaySeconds: 0, startSeconds: 2, audible: true });
  });

  it('plays from the start with no delay at offset 0', () => {
    expect(placeRecording(0, 20)).toEqual({ delaySeconds: 0, startSeconds: 0, audible: true });
  });

  it('clamps an out-of-range offset to the shared range', () => {
    expect(placeRecording(-100, 60).delaySeconds).toBe(30);
    expect(placeRecording(100, 60).startSeconds).toBe(30);
    expect(placeRecording(Number.NaN, 20)).toEqual({ delaySeconds: 0, startSeconds: 0, audible: true });
  });

  it('is silent for the whole output when the delay reaches the tab length (-30 s, 20 s tab)', () => {
    const p = placeRecording(-30, 20);
    expect(p.delaySeconds).toBe(30);
    expect(p.audible).toBe(false);
  });

  it('is silent when the delay equals the tab length exactly', () => {
    expect(placeRecording(-20, 20).audible).toBe(false);
  });
});
