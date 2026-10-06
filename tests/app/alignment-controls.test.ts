import { describe, expect, it } from 'vitest';
import { AlignmentMap } from '../../src/audio/alignment-map';
import {
  SECTION_MIN_SECONDS,
  describeSections,
  nudgeSection,
  removeSection,
  revertToManual,
  statusText,
} from '../../src/app/alignment-controls';
import { makeTimeline } from '../helpers/make-timeline';

const timeline = makeTimeline([], 2, 30);

describe('describeSections', () => {
  it('names the bar the tab waits after and the length to one decimal', () => {
    // the bar line at 32 s ends score bar 16 (bars are 2 s long and numbered from 1)
    const map = AlignmentMap.of(1.5, [{ at: 32, length: 8.24 }]);
    expect(describeSections(map, timeline)).toEqual([{ index: 0, label: 'Extra playing after bar 16, 8.2 s' }]);
  });

  it('falls back to a time when the hold is not on a known bar line', () => {
    const map = AlignmentMap.of(0, [{ at: 33.3, length: 2 }]);
    expect(describeSections(map, timeline)[0].label).toBe('Extra playing at 33.3 s, 2.0 s');
  });

  it('lists nothing for a map with no holds', () => {
    expect(describeSections(AlignmentMap.fromOffset(2), timeline)).toEqual([]);
  });
});

describe('nudgeSection', () => {
  const map = AlignmentMap.of(1, [{ at: 20, length: 8 }]);

  it('moves a hold by exactly the fine and coarse steps', () => {
    expect(nudgeSection(map, 0, 'fine', 1).holds[0].length).toBeCloseTo(8.01, 9);
    expect(nudgeSection(map, 0, 'fine', -1).holds[0].length).toBeCloseTo(7.99, 9);
    expect(nudgeSection(map, 0, 'coarse', 1).holds[0].length).toBeCloseTo(8.1, 9);
    expect(nudgeSection(map, 0, 'coarse', -1).holds[0].length).toBeCloseTo(7.9, 9);
  });

  it('stops at the shortest a section may be; removing is the only way to delete one', () => {
    const short = AlignmentMap.of(1, [{ at: 20, length: 0.15 }]);
    const nudged = nudgeSection(short, 0, 'coarse', -1);
    expect(nudged.holds).toEqual([{ at: 20, length: SECTION_MIN_SECONDS }]);
    expect(nudgeSection(nudged, 0, 'fine', -1).holds).toEqual([{ at: 20, length: SECTION_MIN_SECONDS }]);
  });

  it('leaves the base offset and the other sections alone', () => {
    const two = AlignmentMap.of(1, [
      { at: 10, length: 3 },
      { at: 20, length: 8 },
    ]);
    const out = nudgeSection(two, 1, 'fine', 1);
    expect(out.base).toBe(1);
    expect(out.holds[0]).toEqual({ at: 10, length: 3 });
  });
});

describe('removeSection and revertToManual', () => {
  const map = AlignmentMap.of(1.5, [
    { at: 10, length: 3 },
    { at: 20, length: 8 },
  ]);

  it('covers AE4: removing a section and then reverting leaves the manual single offset', () => {
    const removed = removeSection(map, 0);
    expect(removed.holds).toEqual([{ at: 20, length: 8 }]);
    const reverted = revertToManual(removed);
    expect(reverted.holds).toEqual([]);
    expect(reverted.base).toBe(1.5);
  });
});

describe('statusText', () => {
  it('words every state, with the percentage while analysing', () => {
    expect(statusText({ phase: 'idle' })).toBe('');
    expect(statusText({ phase: 'analysing', progress: 0.426 })).toContain('43%');
    expect(statusText({ phase: 'found', sections: 0, skipped: 0 })).toMatch(/no extra playing/i);
    expect(statusText({ phase: 'found', sections: 1, skipped: 0 })).toMatch(/1 section of extra playing/);
    expect(statusText({ phase: 'found', sections: 3, skipped: 0 })).toMatch(/3 sections of extra playing/);
    expect(statusText({ phase: 'not-found', reason: 'not-confident' })).toMatch(/unchanged/);
    expect(statusText({ phase: 'failed', reason: 'no-sound' })).toMatch(/sound/);
    expect(statusText({ phase: 'discarded' })).toMatch(/Re-analyse/);
    expect(statusText({ phase: 'manual' })).toMatch(/by hand/);
    expect(statusText({ phase: 'waiting' })).toMatch(/sound/);
  });

  it('counts the sections the alignment has now, not the ones that were found', () => {
    const found = { phase: 'found', sections: 3, skipped: 0 } as const;
    expect(statusText(found, 1)).toMatch(/1 section of extra playing/);
    expect(statusText(found, 0)).toMatch(/no extra playing/i);
  });

  it('says so when the tab jumps past bars the recording skips', () => {
    expect(statusText({ phase: 'found', sections: 1, skipped: 1 })).toMatch(/jumps past 1 stretch the recording skips/);
    expect(statusText({ phase: 'found', sections: 1, skipped: 2 })).toMatch(/jumps past 2 stretches/);
    expect(statusText({ phase: 'found', sections: 1, skipped: 0 })).not.toMatch(/jumps past/);
  });

  it('says something different for each way a search can come up empty', () => {
    const texts = (['too-long', 'silent', 'not-confident', 'out-of-range'] as const).map((reason) =>
      statusText({ phase: 'not-found', reason }),
    );
    expect(new Set(texts).size).toBe(4);
  });
});
