import { describe, expect, it } from 'vitest';
import { describeDiff, diffAlignments, MOVED_SECONDS } from '../../src/app/alignment-diff';
import type { AlignmentRecord, BarEvidence } from '../../src/audio/recording-profile';

const sig = (n: number) => `sig${n}`;

/** A record with bars `tabs` (tab bar names), placed at `starts`, each as detected unless `detected` says otherwise. */
function record(tabs: number[], starts: number[], over: Partial<AlignmentRecord> = {}, detected: number[] = starts): AlignmentRecord {
  const evidence: BarEvidence[] = tabs.map((t, k) => ({ tab: sig(t), detected: detected[k], confidence: 5, matched: true }));
  return { source: 'auto', holds: [], anchors: starts, endAnchor: starts[starts.length - 1] + 2, evidence, ...over };
}

const base = [0, 1, 2, 3, 4, 5, 6, 7];
const placed = base.map((k) => 1 + k * 2);

describe('diffAlignments', () => {
  it('counts bars whose tab bar changed, and bars whose start moved, as re-pinned', () => {
    const previous = record(base, placed);
    const tabs = [0, 1, 2, 30, 31, 5, 6, 7];
    const next = record(tabs, placed.map((s, k) => (k === 6 ? s + 0.4 : s)));
    expect(diffAlignments(previous, next)).toMatchObject({ repinned: 3, tabBarsChanged: 2 });
  });

  it('does not count a bar that kept its tab bar and moved less than a hundredth or two', () => {
    const next = record(base, placed.map((s) => s + MOVED_SECONDS / 2));
    expect(diffAlignments(record(base, placed), next)).toBeNull();
  });

  it('matches by tab bar, so bars inserted into the tab do not make every later bar look moved', () => {
    const previous = record(base, placed);
    const tabs = [0, 1, 2, 99, 3, 4, 5, 6, 7];
    const starts = [1, 3, 5, 7, 9, 11, 13, 15, 17];
    const diff = diffAlignments(previous, record(tabs, starts));
    expect(diff?.tabBarsChanged).toBe(1);
    expect(diff?.repinned).toBe(1 + 5);
  });

  it('a removed bar is not counted as re-pinned: it no longer exists', () => {
    const previous = record(base, placed);
    const next = record([0, 1, 2, 4, 5, 6, 7], [1, 3, 5, 9, 11, 13, 15]);
    expect(diffAlignments(previous, next)).toBeNull();
  });

  it('counts the bars the player moved by hand and detection did not agree with as edits replaced', () => {
    const edited = placed.map((s, k) => (k === 2 || k === 5 ? s + 0.8 : s));
    const previous = record(base, edited, {}, placed);
    const next = record(base, placed);
    const diff = diffAlignments(previous, next);
    expect(diff?.editsReplaced).toBe(2);
    expect(diff?.repinned).toBe(2);
  });

  it('does not count an edit that detection arrived at again', () => {
    const edited = placed.map((s, k) => (k === 2 ? s + 0.8 : s));
    const previous = record(base, edited, {}, placed);
    const next = record(base, edited);
    expect(diffAlignments(previous, next)).toBeNull();
  });

  it('counts the sections that keep the player\'s names', () => {
    const next = record([0, 1, 2, 30], [1, 3, 5, 7], { sections: [{ firstBar: 0, lastBar: 1, letter: 'A', name: 'Verse' }, { firstBar: 2, lastBar: 3, letter: 'B' }] });
    expect(diffAlignments(record([0, 1, 2, 3], [1, 3, 5, 7]), next)?.sectionsKept).toBe(1);
  });

  it('is null when there is no saved timeline to compare with, or the detection has no anchors', () => {
    expect(diffAlignments(null, record(base, placed))).toBeNull();
    expect(diffAlignments({ source: 'manual', holds: [] }, record(base, placed))).toBeNull();
    expect(diffAlignments(record(base, placed), { source: 'manual', holds: [] })).toBeNull();
  });

  it('is null for an identical re-detection', () => {
    expect(diffAlignments(record(base, placed), record(base, placed))).toBeNull();
  });

  it('without tab names, compares by position when the bar counts agree and calls every bar re-pinned otherwise', () => {
    const bare = (starts: number[]): AlignmentRecord => ({ source: 'auto', holds: [], anchors: starts, endAnchor: 20 });
    expect(diffAlignments(bare(placed), bare(placed.map((s, k) => (k === 0 ? s + 1 : s))))?.repinned).toBe(1);
    expect(diffAlignments(bare(placed), bare(placed.slice(0, 5)))?.repinned).toBe(5);
  });
});

describe('describeDiff', () => {
  it('says how many bars were re-pinned, with the edits replaced and the sections kept when there are any', () => {
    expect(describeDiff({ repinned: 38, tabBarsChanged: 38, editsReplaced: 0, sectionsKept: 0 })).toBe('38 bars re-pinned');
    expect(describeDiff({ repinned: 38, tabBarsChanged: 30, editsReplaced: 2, sectionsKept: 2 })).toBe('38 bars re-pinned, 2 of your edits replaced, 2 sections kept');
    expect(describeDiff({ repinned: 1, tabBarsChanged: 0, editsReplaced: 1, sectionsKept: 1 })).toBe('1 bar re-pinned, 1 edit of yours replaced, 1 section kept');
  });
});
