import { describe, expect, it } from 'vitest';
import { AlignmentMap } from '../../src/audio/alignment-map';
import type { AnalysisResult } from '../../src/alignment/analyze';
import { decideAutoAlign, settleAnalysis } from '../../src/app/auto-align';

describe('decideAutoAlign', () => {
  it('runs for a recording with nothing saved and nothing moved by the user', () => {
    expect(decideAutoAlign({ hasProfile: false, offsetMoved: false })).toBe('run');
  });
  it('skips when a profile exists: a saved alignment is restored, and a saved offset from before counts as set by hand', () => {
    expect(decideAutoAlign({ hasProfile: true, offsetMoved: false })).toBe('skip');
  });
  it('skips when the user already moved the offset', () => {
    expect(decideAutoAlign({ hasProfile: false, offsetMoved: true })).toBe('skip');
  });
});

describe('settleAnalysis', () => {
  const live = { stillCurrent: true, offsetMoved: false };
  const aligned: AnalysisResult = { kind: 'aligned', map: AlignmentMap.of(1.5, [{ at: 20, length: 16 }]), confidence: 6, matchedFraction: 1 };

  it('applies a confident result and counts the sections', () => {
    const out = settleAnalysis(live, aligned);
    expect(out?.map?.holds).toEqual([{ at: 20, length: 16 }]);
    expect(out?.status).toEqual({ phase: 'found', sections: 1 });
  });

  it('discards a result when the user moved the offset in the meantime', () => {
    const out = settleAnalysis({ ...live, offsetMoved: true }, aligned);
    expect(out?.map).toBeNull();
    expect(out?.status).toEqual({ phase: 'discarded' });
  });

  it('leaves the offset alone and says so for not-found and failed results', () => {
    expect(settleAnalysis(live, { kind: 'not-found', reason: 'not-confident' })).toEqual({
      map: null,
      status: { phase: 'not-found', reason: 'not-confident' },
    });
    expect(settleAnalysis(live, { kind: 'failed', reason: 'render' })).toEqual({
      map: null,
      status: { phase: 'failed', reason: 'render' },
    });
  });

  it('ignores a result for a recording that is no longer the loaded one, and a cancelled run', () => {
    expect(settleAnalysis({ ...live, stillCurrent: false }, aligned)).toBeNull();
    expect(settleAnalysis(live, { kind: 'cancelled' })).toBeNull();
  });
});
