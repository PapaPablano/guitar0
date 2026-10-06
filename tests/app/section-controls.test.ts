import { describe, expect, it } from 'vitest';
import {
  carryNames,
  describeSectionRows,
  jumpTarget,
  landingText,
  loopFor,
  readoutOf,
  renameSection,
  sectionIndexAt,
} from '../../src/app/section-controls';
import type { SectionRecord } from '../../src/audio/recording-profile';
import { makeTimeline } from '../helpers/make-timeline';

/** 40 bars of 2 s, so bar n starts at 2 * n seconds. */
const timeline = makeTimeline([], 2, 40);
const five: SectionRecord[] = [
  { firstBar: 0, lastBar: 7, letter: 'A' },
  { firstBar: 8, lastBar: 15, letter: 'B' },
  { firstBar: 16, lastBar: 23, letter: 'A' },
  { firstBar: 24, lastBar: 31, letter: 'B' },
  { firstBar: 32, lastBar: 39, letter: 'C' },
];
const allGood = { barConfidence: new Array<number>(40).fill(5), barMatched: new Array<boolean>(40).fill(true) };

describe('describeSectionRows', () => {
  it('covers AE5: five sections read A, B, A, B and C with their bar ranges', () => {
    const rows = describeSectionRows(five, timeline, allGood, {});
    expect(rows.map((r) => r.label)).toEqual(['Section A', 'Section B', 'Section A', 'Section B', 'Section C']);
    expect(rows.map((r) => r.bars)).toEqual(['bars 1 to 8', 'bars 9 to 16', 'bars 17 to 24', 'bars 25 to 32', 'bars 33 to 40']);
  });

  it('shows the name the user gave a section and keeps its letter beside it', () => {
    const named = renameSection(five, 1, 'Chorus');
    const rows = describeSectionRows(named, timeline, allGood, {});
    expect(rows[1].label).toBe('Chorus');
    expect(rows[1].letter).toBe('B');
    expect(rows[0].label).toBe('Section A');
  });

  it('calls a single section that spans the song "Whole song"', () => {
    const rows = describeSectionRows([{ firstBar: 0, lastBar: 39, letter: 'A' }], timeline, allGood, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Whole song');
  });

  it('shows the latest landing error in milliseconds, and nothing before any jump', () => {
    const rows = describeSectionRows(five, timeline, allGood, { 1: 0.0124 });
    expect(rows[1].landing).toBe('last landing 12 ms');
    expect(rows[0].landing).toBe('');
  });
});

describe('readoutOf', () => {
  const sec = { firstBar: 2, lastBar: 5, letter: 'A' };

  it('covers AE8: a section whose bars were mostly not matched reads not matched, a mixed one uncertain, a clean one confident', () => {
    const matched = new Array<boolean>(10).fill(true);
    const confidence = new Array<number>(10).fill(5);
    expect(readoutOf(sec, { barConfidence: confidence, barMatched: matched })).toBe('confident');

    const mixed = matched.slice();
    mixed[3] = false;
    expect(readoutOf(sec, { barConfidence: confidence, barMatched: mixed })).toBe('uncertain');

    const mostlyNot = matched.map((_, k) => k < 2 || k > 5);
    expect(readoutOf(sec, { barConfidence: confidence, barMatched: mostlyNot })).toBe('not matched');
  });

  it('reads a bar with no onset peak as uncertain even when it was matched', () => {
    const confidence = new Array<number>(10).fill(5);
    confidence[4] = 0;
    expect(readoutOf(sec, { barConfidence: confidence, barMatched: new Array<boolean>(10).fill(true) })).toBe('uncertain');
  });

  it('says it was not measured when there is nothing to read, as after a restore', () => {
    expect(readoutOf(sec, { barConfidence: [], barMatched: [] })).toBe('not measured');
  });
});

describe('jump and loop targets', () => {
  it('covers AE5: a jump goes to the first bar of the section, in tab seconds', () => {
    expect(jumpTarget(five[3], timeline)).toBe(48);
    expect(jumpTarget(five[0], timeline)).toBe(0);
  });

  it('covers AE6: a loop runs from the section\'s first bar to its last, in the tab\'s bar numbers, the same every time', () => {
    const loop = loopFor(five[1], timeline);
    expect(loop).toEqual({ startBar: 8, endBar: 15 });
    expect(loopFor(five[1], timeline)).toEqual(loop);
  });

  it('finds the section a bar belongs to', () => {
    expect(sectionIndexAt(five, 0)).toBe(0);
    expect(sectionIndexAt(five, 15)).toBe(1);
    expect(sectionIndexAt(five, 16)).toBe(2);
    expect(sectionIndexAt(five, 39)).toBe(4);
    expect(sectionIndexAt(five, 99)).toBe(-1);
  });
});

describe('renameSection and carryNames', () => {
  it('renames one section and leaves the others', () => {
    const out = renameSection(five, 2, '  Verse  ');
    expect(out[2].name).toBe('Verse');
    expect(out[0].name).toBeUndefined();
    expect(five[2].name).toBeUndefined();
  });

  it('puts the letter back when the name is emptied, and stops a name that is too long', () => {
    const named = renameSection(five, 0, 'Intro');
    expect(renameSection(named, 0, '   ')[0].name).toBeUndefined();
    expect(renameSection(five, 0, 'x'.repeat(100))[0].name).toHaveLength(40);
  });

  it('keeps the names the user gave when the sections are found again over the same bars', () => {
    const old = renameSection(five, 1, 'Chorus');
    const found = five.map((s) => ({ firstBar: s.firstBar, lastBar: s.lastBar, letter: s.letter }));
    expect(carryNames(old, found)[1].name).toBe('Chorus');
    // a section whose bars changed gets no name
    const moved = found.map((s, i) => (i === 1 ? { ...s, firstBar: 9 } : s));
    expect(carryNames(old, moved)[1].name).toBeUndefined();
  });
});

describe('landingText', () => {
  it('rounds to whole milliseconds', () => {
    expect(landingText(0.0129)).toBe('last landing 13 ms');
    expect(landingText(0)).toBe('last landing 0 ms');
  });
});
