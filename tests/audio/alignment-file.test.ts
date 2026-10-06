import { describe, expect, it } from 'vitest';
import { ALIGNMENT_FILE_VERSION, normalizeAlignmentRecord, parseAlignmentFile, toAlignmentFile } from '../../src/audio/alignment-file';
import type { AlignmentRecord } from '../../src/audio/recording-profile';
import { barSignature, tabFingerprint } from '../../src/audio/tab-fingerprint';

const HASH = 'a'.repeat(64);

const full = (): AlignmentRecord => ({
  source: 'auto',
  holds: [{ at: 8, length: 2 }],
  anchors: [1.5, 3.5, 5.5],
  endAnchor: 7.5,
  evidence: [
    { detected: 1.5, tab: 'aa11aa11', confidence: 5.25, matched: true },
    { detected: 3.5, tab: 'bb22bb22', confidence: 0, matched: false },
    { detected: 5.5, tab: 'cc33cc33', confidence: 4.1, matched: true },
  ],
  sections: [{ firstBar: 0, lastBar: 2, letter: 'A', name: 'Intro riff' }],
  revision: 1,
  fingerprint: '3:0f0f0f0f',
  tier: 'lined-up',
  previousOffset: 0.4,
});

describe('the alignment file', () => {
  it('round-trips a full record unchanged', () => {
    const record = full();
    expect(parseAlignmentFile(toAlignmentFile(HASH, record), HASH)).toEqual(record);
  });

  it('survives being written out as text and read back', () => {
    const text = JSON.stringify(toAlignmentFile(HASH, full()), null, 2);
    expect(parseAlignmentFile(JSON.parse(text), HASH)).toEqual(full());
  });

  it('lists one entry per bar with its start, detected position, tab name, confidence and matched flag', () => {
    const file = toAlignmentFile(HASH, full());
    expect(file.recording).toBe(HASH);
    expect(file.version).toBe(ALIGNMENT_FILE_VERSION);
    expect(file.bars).toEqual([
      { bar: 1, start: 1.5, detected: 1.5, matched: true, confidence: 5.25, tab: 'aa11aa11' },
      { bar: 2, start: 3.5, detected: 3.5, matched: false, confidence: 0, tab: 'bb22bb22' },
      { bar: 3, start: 5.5, detected: 5.5, matched: true, confidence: 4.1, tab: 'cc33cc33' },
    ]);
    expect(file.endAnchor).toBe(7.5);
  });

  it('writes times to the millisecond so the file reads cleanly', () => {
    const file = toAlignmentFile(HASH, { source: 'auto', holds: [], anchors: [1.23456789], endAnchor: 2.0000001, evidence: [{ detected: 1.23456789 }] });
    expect(file.bars?.[0]).toMatchObject({ start: 1.235, detected: 1.235 });
    expect(file.endAnchor).toBe(2);
  });

  it('reads a hand-edited start as the edited value while detected keeps the original', () => {
    const file = toAlignmentFile(HASH, full());
    file.bars![1].start = 3.9;
    const record = parseAlignmentFile(file, HASH)!;
    expect(record.anchors).toEqual([1.5, 3.9, 5.5]);
    expect(record.evidence?.[1].detected).toBe(3.5);
  });

  it('reads a file that carries only starts, with no evidence', () => {
    const record = parseAlignmentFile({ version: 1, recording: HASH, source: 'auto', holds: [], endAnchor: 7, bars: [{ start: 1 }, { start: 3 }] }, HASH);
    expect(record).toEqual({ source: 'auto', holds: [], anchors: [1, 3], endAnchor: 7 });
    expect(record).not.toHaveProperty('evidence');
  });

  it('keeps holds and the source of a record with no anchors', () => {
    const record: AlignmentRecord = { source: 'manual', holds: [{ at: 20, length: 8 }] };
    const file = toAlignmentFile(HASH, record);
    expect(file).not.toHaveProperty('bars');
    expect(parseAlignmentFile(file, HASH)).toEqual(record);
  });

  it('reads as no alignment for anything that is not a file for this recording', () => {
    const good = toAlignmentFile(HASH, full());
    expect(parseAlignmentFile({ ...good, recording: 'b'.repeat(64) }, HASH)).toBeNull();
    expect(parseAlignmentFile({ ...good, version: 99 }, HASH)).toBeNull();
    expect(parseAlignmentFile({ ...good, source: 'x' }, HASH)).toBeNull();
    for (const junk of [null, 5, 'text', [1, 2], {}]) expect(parseAlignmentFile(junk, HASH)).toBeNull();
  });

  it('drops the anchors, but keeps the rest, when a start is not a number, the end anchor is missing, or the list is empty', () => {
    const base = { version: 1, recording: HASH, source: 'auto', holds: [] };
    const expected = { source: 'auto', holds: [] };
    expect(parseAlignmentFile({ ...base, endAnchor: 5, bars: [{ start: 1 }, { start: 'x' }] }, HASH)).toEqual(expected);
    expect(parseAlignmentFile({ ...base, bars: [{ start: 1 }] }, HASH)).toEqual(expected);
    expect(parseAlignmentFile({ ...base, endAnchor: Number.NaN, bars: [{ start: 1 }] }, HASH)).toEqual(expected);
    expect(parseAlignmentFile({ ...base, endAnchor: 5, bars: [] }, HASH)).toEqual(expected);
  });

  it('keeps the anchors when only the sections list is malformed, overlapping or out of order', () => {
    const bad = [
      [{ firstBar: 0, lastBar: 1, letter: 'A' }, { firstBar: 1, lastBar: 3, letter: 'B' }],
      [{ firstBar: 4, lastBar: 5, letter: 'A' }, { firstBar: 0, lastBar: 1, letter: 'B' }],
      [{ firstBar: 0, lastBar: -1, letter: 'A' }],
      [{ firstBar: 0.5, lastBar: 1, letter: 'A' }],
      [{ firstBar: 0, lastBar: 1, letter: '' }],
      ['junk'],
    ];
    for (const sections of bad) {
      const record = parseAlignmentFile({ ...toAlignmentFile(HASH, full()), sections }, HASH)!;
      expect(record.anchors).toEqual([1.5, 3.5, 5.5]);
      expect(record).not.toHaveProperty('sections');
    }
  });

  it('keeps a section but drops a name that is not text or is too long', () => {
    const record = normalizeAlignmentRecord({
      source: 'auto',
      holds: [],
      sections: [{ firstBar: 0, lastBar: 3, letter: 'A', name: 'x'.repeat(200) }, { firstBar: 4, lastBar: 7, letter: 'B', name: 5 }],
    });
    expect(record?.sections).toEqual([
      { firstBar: 0, lastBar: 3, letter: 'A' },
      { firstBar: 4, lastBar: 7, letter: 'B' },
    ]);
  });

  it('cleans the holds: unusable ones are dropped and the rest are sorted', () => {
    const record = normalizeAlignmentRecord({ source: 'auto', holds: [{ at: 30, length: 2 }, { at: 10, length: -1 }, 'x', { at: 5, length: 1 }] });
    expect(record?.holds).toEqual([
      { at: 5, length: 1 },
      { at: 30, length: 2 },
    ]);
  });

  it('a field with a bad type reads as absent and keeps the anchors and the section names', () => {
    const file = { ...toAlignmentFile(HASH, full()), revision: 'one', fingerprint: 42, tier: 'great', attempt: { revision: 1 }, previousOffset: 'x' };
    const record = parseAlignmentFile(file, HASH)!;
    expect(record.anchors).toEqual([1.5, 3.5, 5.5]);
    expect(record.sections?.[0].name).toBe('Intro riff');
    for (const key of ['revision', 'fingerprint', 'tier', 'attempt', 'previousOffset']) expect(record).not.toHaveProperty(key);
  });

  it('keeps a remembered failed attempt', () => {
    const record: AlignmentRecord = { source: 'manual', holds: [], attempt: { revision: 1, fingerprint: '6:0f0f0f0f' } };
    expect(parseAlignmentFile(toAlignmentFile(HASH, record), HASH)).toEqual(record);
  });
});

describe('barSignature', () => {
  it('names a bar by its start and end to the millisecond, and another bar differently', () => {
    expect(barSignature({ start: 1, end: 3 })).toBe(barSignature({ start: 1.0004, end: 3.0004 }));
    expect(barSignature({ start: 1, end: 3 })).not.toBe(barSignature({ start: 1, end: 3.01 }));
    expect(barSignature({ start: 1, end: 3 })).toMatch(/^[0-9a-f]{8}$/);
  });

  it('leaves the whole-tab fingerprint as it was', () => {
    expect(tabFingerprint([{ start: 0, end: 2 }])).toMatch(/^1:[0-9a-f]{8}$/);
  });
});
