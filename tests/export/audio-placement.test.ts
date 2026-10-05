import { describe, expect, it } from 'vitest';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { exportLength, outputWindow, placeRecording, tabTimeAt } from '../../src/export/audio';

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

describe('export through the alignment map', () => {
  const map = AlignmentMap.of(1.5, [{ at: 40, length: 8 }]);

  it('makes the output as long as the tab plus the extra playing', () => {
    expect(exportLength(60, map)).toBe(68);
    expect(exportLength(60, AlignmentMap.fromOffset(2))).toBe(60);
    expect(exportLength(60, null)).toBe(60);
  });

  it('shows the tab waiting at the bar line for the whole of the extra playing, then going on', () => {
    // output time v is recording position v + base: the extra playing is output 40 to 48
    expect(tabTimeAt(map, 39.9)).toBeCloseTo(39.9, 6);
    expect(tabTimeAt(map, 40)).toBeCloseTo(39.999, 6);
    expect(tabTimeAt(map, 44)).toBeCloseTo(39.999, 6);
    expect(tabTimeAt(map, 47.99)).toBeCloseTo(39.999, 6);
    expect(tabTimeAt(map, 48.01)).toBeCloseTo(40.01, 6);
    expect(tabTimeAt(map, 68)).toBeCloseTo(60, 6);
  });

  it('is the output time itself when there are no holds, exactly as before', () => {
    for (const v of [0, 1 / 3, 12.345678901234, 59.99]) {
      expect(tabTimeAt(AlignmentMap.fromOffset(1.5), v)).toBe(v);
      expect(tabTimeAt(null, v)).toBe(v);
    }
  });

  it('turns a loop in tab time into a window of the output, including extra playing inside it', () => {
    expect(outputWindow(map, { startSeconds: 35, endSeconds: 45 })).toEqual({ startSeconds: 35, endSeconds: 53 });
    // a loop that ends on the hold's bar line stops on arrival; one that starts there starts after the extra playing
    expect(outputWindow(map, { startSeconds: 30, endSeconds: 40 })).toEqual({ startSeconds: 30, endSeconds: 40 });
    expect(outputWindow(map, { startSeconds: 40, endSeconds: 50 })).toEqual({ startSeconds: 48, endSeconds: 58 });
  });

  it('leaves a loop alone when there are no holds', () => {
    const range = { startSeconds: 4.2, endSeconds: 9.1 };
    expect(outputWindow(AlignmentMap.fromOffset(3), range)).toEqual(range);
    expect(outputWindow(null, range)).toEqual(range);
  });
});
