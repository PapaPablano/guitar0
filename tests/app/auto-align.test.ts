import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../src/alignment/analyze';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { tabFingerprint } from '../../src/audio/tab-fingerprint';
import {
  decideOnOpen,
  restoreFromRecord,
  recordFromMap,
  settleAnalysis,
  TIMELINE_REVISION,
  withAttempt,
  type SettleContext,
} from '../../src/app/auto-align';

const bars = Array.from({ length: 6 }, (_, i) => ({ start: i * 2, end: i * 2 + 2 }));
const good = AlignmentMap.fromAnchors(bars, [1.5, 3.5, 5.5, 7.5, 9.5, 11.5], 13.5)!;
/** Anchors that make a bar far too short to be played: a failed check. */
const broken = AlignmentMap.fromAnchors(bars, [1.5, 3.5, 3.52, 7.5, 9.5, 11.5], 13.5)!;

const ctx: SettleContext = { stillCurrent: true, offsetMovedSinceStart: false, bars, hasTimeline: false };

const aligned = (over: Partial<Extract<AnalysisResult, { kind: 'aligned' }>> = {}): AnalysisResult => ({
  kind: 'aligned',
  map: good,
  perBarMap: good,
  tier: 'lined-up',
  confidence: 6,
  matchedFraction: 1,
  skippedStretches: 0,
  barConfidence: [],
  barMatched: [],
  sections: [],
  ...over,
});

describe('settleAnalysis', () => {
  it('commits a result that passes the check, with its tier, sections and readout', () => {
    const out = settleAnalysis(ctx, aligned({ barConfidence: [5, 0], barMatched: [true, false], sections: [{ firstBar: 0, lastBar: 1, letter: 'A' }] }));
    expect(out?.map).toBe(good);
    expect(out?.status).toEqual({ phase: 'lined-up', skipped: 0 });
    expect(out?.tier).toBe('lined-up');
    expect(out?.sections).toEqual([{ firstBar: 0, lastBar: 1, letter: 'A' }]);
    expect(out?.barConfidence).toEqual([5, 0]);
  });

  it('says roughly lined up when the tier is roughly, and counts the stretches the recording skips', () => {
    const out = settleAnalysis(ctx, aligned({ tier: 'roughly', skippedStretches: 2 }));
    expect(out?.status).toEqual({ phase: 'roughly', skipped: 2 });
  });

  it('on a first open, a whole-song result that fails the check falls back to the bar-by-bar result if that passes', () => {
    const out = settleAnalysis(ctx, aligned({ map: broken, perBarMap: good }));
    expect(out?.map).toBe(good);
    expect(out?.status.phase).toBe('roughly');
    expect(out?.tier).toBe('roughly');
  });

  it('on a first open where both fail, reports not lined up as inconsistent and remembers the attempt', () => {
    const out = settleAnalysis(ctx, aligned({ map: broken, perBarMap: broken }));
    expect(out?.map).toBeNull();
    expect(out?.status).toEqual({ phase: 'not-found', reason: 'inconsistent' });
    expect(out?.remember).toBe(true);
  });

  it('keeps the timeline in use when a new detection fails the check', () => {
    const out = settleAnalysis({ ...ctx, hasTimeline: true }, aligned({ map: broken, perBarMap: good }));
    expect(out?.map).toBeNull();
    expect(out?.status).toEqual({ phase: 'kept-previous' });
    expect(out?.remember).toBe(true);
  });

  it('covers AE8: detection that finds nothing changes no offset and says so, and is remembered', () => {
    const out = settleAnalysis(ctx, { kind: 'not-found', reason: 'not-confident' });
    expect(out).toMatchObject({ map: null, status: { phase: 'not-found', reason: 'not-confident' }, remember: true });
    expect(settleAnalysis({ ...ctx, hasTimeline: true }, { kind: 'not-found', reason: 'silent' })?.status).toEqual({ phase: 'kept-previous' });
  });

  it('does not remember a transient failure', () => {
    expect(settleAnalysis(ctx, { kind: 'failed', reason: 'render' })).toMatchObject({ map: null, status: { phase: 'failed', reason: 'render' }, remember: false });
  });

  it('applies a result when the offset moved before the run began, and drops it when it moved after', () => {
    expect(settleAnalysis({ ...ctx, offsetMovedSinceStart: false }, aligned())?.map).toBe(good);
    const dropped = settleAnalysis({ ...ctx, offsetMovedSinceStart: true }, aligned());
    expect(dropped?.map).toBeNull();
    expect(dropped?.status).toEqual({ phase: 'idle' });
  });

  it('never commits a result of another recording or tab, or of a cancelled run', () => {
    expect(settleAnalysis({ ...ctx, stillCurrent: false }, aligned())).toBeNull();
    expect(settleAnalysis(ctx, { kind: 'cancelled' })).toBeNull();
  });

  it('refuses a map of the older form, which has no anchors to check', () => {
    const out = settleAnalysis(ctx, aligned({ map: AlignmentMap.of(1, []), perBarMap: AlignmentMap.of(1, []) }));
    expect(out?.map).toBeNull();
    expect(out?.status).toEqual({ phase: 'not-found', reason: 'inconsistent' });
  });
});

describe('mapFromRecord and recordFromMap', () => {
  it('a saved timeline comes back as the same anchors, with the sections and their names', () => {
    const sections = [{ firstBar: 0, lastBar: 5, letter: 'A', name: 'Whole' }];
    const record = recordFromMap(good, 'auto', sections);
    expect(record.anchors).toEqual([1.5, 3.5, 5.5, 7.5, 9.5, 11.5]);
    expect(record.endAnchor).toBe(13.5);
    expect(record.sections).toEqual(sections);
    const back = restoreFromRecord(1.5, record, bars).map;
    expect(back.hasAnchors).toBe(true);
    expect(back.toRec(4, 'start')).toBeCloseTo(5.5, 9);
  });

  it('falls back to the offset and holds when the anchors do not fit the bars, or when there are none', () => {
    const record = { source: 'auto' as const, holds: [{ at: 4, length: 2 }], anchors: [1, 2], endAnchor: 3 };
    const wrong = restoreFromRecord(1.5, record, bars).map;
    expect(wrong.hasAnchors).toBe(false);
    expect(wrong.holds).toEqual([{ at: 4, length: 2 }]);
    expect(restoreFromRecord(2, undefined, bars).map.base).toBe(2);
  });

  it('saves a first-form map without anchors, and no revision or fingerprint', () => {
    expect(recordFromMap(AlignmentMap.of(1, [{ at: 4, length: 2 }]), 'manual', [])).toEqual({ source: 'manual', holds: [{ at: 4, length: 2 }] });
  });

  it('stamps the revision, fingerprint, tier and the offset it replaced only when asked, which is when a detected timeline commits', () => {
    const fingerprint = tabFingerprint(bars);
    const record = recordFromMap(good, 'auto', [], { fingerprint, tier: 'lined-up', previousOffset: 0.4 });
    expect(record).toMatchObject({ revision: TIMELINE_REVISION, fingerprint, tier: 'lined-up', previousOffset: 0.4 });
    expect(recordFromMap(good, 'auto', [])).not.toHaveProperty('revision');
  });

  it('notes a failed attempt on whatever the record already had', () => {
    const record = recordFromMap(good, 'auto', []);
    const marked = withAttempt(record, 'x');
    expect(marked.anchors).toEqual(record.anchors);
    expect(marked.attempt).toEqual({ revision: TIMELINE_REVISION, fingerprint: 'x' });
    expect(withAttempt(undefined, 'x')).toEqual({ source: 'manual', holds: [], attempt: { revision: TIMELINE_REVISION, fingerprint: 'x' } });
  });
});

describe('decideOnOpen', () => {
  const fingerprint = tabFingerprint(bars);
  const current = () => ({
    version: 1,
    offset: 1.5,
    alignment: recordFromMap(good, 'auto', [], { fingerprint, tier: 'lined-up' }),
  });

  it('detects a recording with nothing saved', () => {
    const decision = decideOnOpen(null, bars);
    expect(decision.action).toBe('detect');
  });

  it('covers AE2: a record with no timeline revision is detected again, playing the older anchors meanwhile', () => {
    const older = { version: 1, offset: 1.5, alignment: recordFromMap(good, 'auto', []) };
    const decision = decideOnOpen(older, bars);
    expect(decision.action).toBe('detect');
    if (decision.action === 'detect') {
      expect(decision.play.hasAnchors).toBe(true);
    }
  });

  it('an offset-only record is detected, and plays the saved offset meanwhile', () => {
    const decision = decideOnOpen({ version: 1, offset: 0.7 }, bars);
    expect(decision.action).toBe('detect');
    if (decision.action === 'detect') {
      expect(decision.play.hasAnchors).toBe(false);
      expect(decision.play.base).toBeCloseTo(0.7, 9);
    }
  });

  it('happy path: a current record is reused with no analysis', () => {
    const decision = decideOnOpen(current(), bars);
    expect(decision.action).toBe('reuse');
    if (decision.action === 'reuse') {
      expect(decision.map.hasAnchors).toBe(true);
      expect(decision.tier).toBe('lined-up');
    }
  });

  it('covers AE4: a record whose fingerprint no longer matches the tab is detected again and never reused', () => {
    const editedBars = bars.map((b, i) => (i === 3 ? { start: b.start, end: b.end + 0.01 } : b));
    const decision = decideOnOpen(current(), editedBars);
    expect(decision.action).toBe('detect');
  });

  it('a record whose anchors no longer fit the bars is detected again, playing the offset', () => {
    const fewer = bars.slice(0, 4);
    const decision = decideOnOpen({ ...current(), alignment: { ...current().alignment, fingerprint: tabFingerprint(fewer) } }, fewer);
    expect(decision.action).toBe('detect');
    if (decision.action === 'detect') expect(decision.play.hasAnchors).toBe(false);
  });

  it('does not repeat a failed attempt for this revision and tab, and does for another tab', () => {
    const failed = { version: 1, offset: 0.7, alignment: withAttempt(undefined, fingerprint) };
    expect(decideOnOpen(failed, bars).action).toBe('stay');
    expect(decideOnOpen(failed, bars.slice(0, 3)).action).toBe('detect');
  });

  it('after a failed re-detection on an older record, plays that record only when it is for this tab, and the saved offset alone otherwise', () => {
    const older = recordFromMap(good, 'auto', []);
    const stale = decideOnOpen({ version: 1, offset: 0.7, alignment: withAttempt(older, fingerprint) }, bars);
    expect(stale.action).toBe('stay');
    if (stale.action === 'stay') expect(stale.play.hasAnchors).toBe(false);
    const stamped = recordFromMap(good, 'auto', [], { fingerprint, tier: 'lined-up' });
    const mine = decideOnOpen({ version: 1, offset: 0.7, alignment: { ...withAttempt(stamped, fingerprint), revision: TIMELINE_REVISION + 1 } }, bars);
    expect(mine.action).toBe('stay');
    if (mine.action === 'stay') expect(mine.play.hasAnchors).toBe(true);
  });
});
