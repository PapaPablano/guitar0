import { describe, expect, it } from 'vitest';
import { AlignmentMap } from '../../src/audio/alignment-map';
import type { AnalysisResult } from '../../src/alignment/analyze';
import { decideAutoAlign, mapFromRecord, needsBaseline, recordFromMap, settleAnalysis } from '../../src/app/auto-align';

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
  const aligned: AnalysisResult = {
    kind: 'aligned',
    map: AlignmentMap.of(1.5, [{ at: 20, length: 16 }]),
    confidence: 6,
    matchedFraction: 1,
    skippedStretches: 2,
    barConfidence: [],
    barMatched: [],
    sections: [],
  };

  it('hands the sections and the bar-by-bar readout on with an applied result', () => {
    const withSections: AnalysisResult = {
      ...aligned,
      barConfidence: [5, 0],
      barMatched: [true, false],
      sections: [{ firstBar: 0, lastBar: 1, letter: 'A' }],
    } as AnalysisResult;
    const out = settleAnalysis(live, withSections);
    expect(out?.sections).toEqual([{ firstBar: 0, lastBar: 1, letter: 'A' }]);
    expect(out?.barConfidence).toEqual([5, 0]);
    expect(out?.barMatched).toEqual([true, false]);
  });

  it('applies a confident result and counts the sections', () => {
    const out = settleAnalysis(live, aligned);
    expect(out?.map?.holds).toEqual([{ at: 20, length: 16 }]);
    expect(out?.status).toEqual({ phase: 'found', sections: 1, skipped: 2 });
  });

  it('discards a result when the user moved the offset in the meantime', () => {
    const out = settleAnalysis({ ...live, offsetMoved: true }, aligned);
    expect(out?.map).toBeNull();
    expect(out?.status).toEqual({ phase: 'discarded' });
  });

  it('leaves the offset alone and says so for not-found and failed results', () => {
    expect(settleAnalysis(live, { kind: 'not-found', reason: 'not-confident' })).toMatchObject({
      map: null,
      status: { phase: 'not-found', reason: 'not-confident' },
      sections: [],
    });
    expect(settleAnalysis(live, { kind: 'failed', reason: 'render' })).toMatchObject({
      map: null,
      status: { phase: 'failed', reason: 'render' },
    });
  });

  it('ignores a result for a recording that is no longer the loaded one, and a cancelled run', () => {
    expect(settleAnalysis({ ...live, stillCurrent: false }, aligned)).toBeNull();
    expect(settleAnalysis(live, { kind: 'cancelled' })).toBeNull();
  });
});

describe('mapFromRecord and recordFromMap', () => {
  const bars = Array.from({ length: 4 }, (_, i) => ({ start: i * 2, end: i * 2 + 2 }));
  const anchored = AlignmentMap.fromAnchors(bars, [1.5, 3.5, 5.5, 7.5], 9.5)!;

  it('covers AE7: a saved baseline comes back as the same anchors, with the sections and their names', () => {
    const sections = [{ firstBar: 0, lastBar: 3, letter: 'A', name: 'Whole' }];
    const record = recordFromMap(anchored, 'auto', sections);
    expect(record.anchors).toEqual([1.5, 3.5, 5.5, 7.5]);
    expect(record.endAnchor).toBe(9.5);
    expect(record.sections).toEqual(sections);
    const back = mapFromRecord(1.5, record, bars);
    expect(back.hasAnchors).toBe(true);
    expect(back.toRec(4, 'start')).toBeCloseTo(5.5, 9);
  });

  it('falls back to the offset and holds when the anchors do not fit the bars, or when there are none', () => {
    const record = { source: 'auto' as const, holds: [{ at: 4, length: 2 }], anchors: [1, 2], endAnchor: 3 };
    const wrong = mapFromRecord(1.5, record, bars);
    expect(wrong.hasAnchors).toBe(false);
    expect(wrong.holds).toEqual([{ at: 4, length: 2 }]);
    expect(mapFromRecord(2, undefined, bars).base).toBe(2);
  });

  it('saves a first-form map without anchors, and never saves sections it does not have', () => {
    const record = recordFromMap(AlignmentMap.of(1, [{ at: 4, length: 2 }]), 'manual', []);
    expect(record).toEqual({ source: 'manual', holds: [{ at: 4, length: 2 }] });
  });
});

describe('a legacy record', () => {
  it('is told apart: an auto record with no anchors needs the bar-level baseline built', () => {
    expect(needsBaseline({ source: 'auto', holds: [{ at: 4, length: 2 }] })).toBe(true);
    expect(needsBaseline({ source: 'auto', holds: [], anchors: [1], endAnchor: 2 })).toBe(false);
    expect(needsBaseline({ source: 'manual', holds: [] })).toBe(false);
  });
});
