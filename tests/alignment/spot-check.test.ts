import { describe, expect, it } from 'vitest';
import { FEATURE_RATE } from '../../src/alignment/features';
import { checkRecord, PINNED_PEAK, SPOT_CHECK, spotCheck } from '../../src/alignment/spot-check';
import type { AlignmentRecord, BarEvidence } from '../../src/audio/recording-profile';

/** A recording of `seconds` that is silent except for a short two-tone burst at each of `onsets` (recording seconds). */
function clicks(seconds: number, onsets: readonly number[]): Float32Array {
  const out = new Float32Array(Math.round(seconds * FEATURE_RATE));
  const burst = Math.round(0.06 * FEATURE_RATE);
  for (const t of onsets) {
    const start = Math.round(t * FEATURE_RATE);
    for (let i = 0; i < burst && start + i < out.length; i++) {
      const decay = Math.exp(-i / (0.012 * FEATURE_RATE));
      out[start + i] += 0.6 * decay * (Math.sin((2 * Math.PI * 440 * i) / FEATURE_RATE) + Math.sin((2 * Math.PI * 1760 * i) / FEATURE_RATE));
    }
  }
  return out;
}

/** Bars every two seconds from 3 s: each bar's start is a click, as a bar placed by its own onsets is. */
const starts = Array.from({ length: 10 }, (_, k) => 3 + k * 2);
const recording = clicks(26, starts);
const pinned = (n: number): BarEvidence[] => Array.from({ length: n }, () => ({ confidence: 5, matched: true }));

describe('spotCheck', () => {
  it('passes a timeline whose anchors sit on the recording\'s onsets', () => {
    const result = spotCheck(recording, starts, pinned(10));
    expect(result.checked).toBe(SPOT_CHECK.samples);
    expect(result.failed).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('fails an anchor moved by hand onto silence, and says which bar', () => {
    const edited = [...starts];
    edited[0] = 5.9;
    edited[9] = 20.55;
    const result = spotCheck(recording, edited, pinned(10));
    expect(result.ok).toBe(false);
    expect(result.failed).toContain(0);
    expect(result.failed).toContain(9);
  });

  it('passes an edit that still lands on a real onset', () => {
    const edited = [...starts];
    edited[3] = 3 + 4 * 2;
    expect(spotCheck(recording, edited, pinned(10)).ok).toBe(true);
  });

  it('passes an anchor a little off its onset, within reach', () => {
    const near = starts.map((s) => s + SPOT_CHECK.reachSeconds / 2);
    expect(spotCheck(recording, near, pinned(10)).ok).toBe(true);
  });

  it('fails an anchor past the end of the recording, or before its start', () => {
    expect(spotCheck(recording, [...starts.slice(0, 9), 400], pinned(10)).failed).toContain(9);
    expect(spotCheck(recording, [-3, ...starts.slice(1)], pinned(10)).failed).toContain(0);
  });

  it('fails a timeline saved for another take, whose onsets fall elsewhere', () => {
    const other = clicks(26, starts.map((s) => s + 0.7));
    expect(spotCheck(other, starts, pinned(10)).ok).toBe(false);
  });

  it('looks only at bars placed by their own onsets, so a bar with no onset of its own is never held against the recording', () => {
    const evidence = pinned(10).map((e, k) => (k === 4 ? { confidence: PINNED_PEAK - 1, matched: true } : e));
    const anchors = [...starts];
    anchors[4] = 12.9;
    expect(spotCheck(recording, anchors, evidence, { ...SPOT_CHECK, samples: 10 }).ok).toBe(true);
  });

  it('checks nothing, and passes, when no bar was placed by its onsets or there is no evidence', () => {
    expect(spotCheck(recording, starts, [])).toEqual({ checked: 0, failed: [], ok: true });
    expect(spotCheck(recording, starts, pinned(10).map(() => ({ confidence: 0 }))).ok).toBe(true);
  });

  it('samples spread over the song, never more than asked for', () => {
    const result = spotCheck(recording, starts, pinned(10), { ...SPOT_CHECK, samples: 3 });
    expect(result.checked).toBe(3);
  });
});

describe('checkRecord', () => {
  const record = (extra: Partial<AlignmentRecord> = {}): AlignmentRecord => ({ source: 'auto', holds: [], anchors: starts, endAnchor: 24, evidence: pinned(10), ...extra });

  it('decodes the recording and runs the check', async () => {
    const result = await checkRecord(new Blob(['x']), record(), async () => recording);
    expect(result?.ok).toBe(true);
  });

  it('is null, so nothing is held against the record, when it has no anchors or no evidence', async () => {
    const decode = async () => recording;
    expect(await checkRecord(new Blob(['x']), { source: 'manual', holds: [] }, decode)).toBeNull();
    expect(await checkRecord(new Blob(['x']), record({ evidence: undefined }), decode)).toBeNull();
  });

  it('is null when the recording cannot be decoded, and never rejects', async () => {
    const decode = async (): Promise<Float32Array> => {
      throw new Error('bad audio');
    };
    expect(await checkRecord(new Blob(['x']), record(), decode)).toBeNull();
  });
});
