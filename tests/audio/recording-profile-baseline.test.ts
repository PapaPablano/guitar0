import { describe, expect, it } from 'vitest';
import { FileProfileStore, PROFILE_VERSION, normalizeProfile, type ProfileFileBackend } from '../../src/audio/recording-profile';

const base = { version: PROFILE_VERSION, offset: 1.5 };
const record = (extra: Record<string, unknown> = {}) => ({ source: 'auto', holds: [], ...extra });

function memoryBackend(): ProfileFileBackend & { data: unknown } {
  const backend = {
    data: null as unknown,
    async read() {
      return backend.data;
    },
    async write(file: unknown) {
      backend.data = file;
    },
  };
  return backend;
}

describe('the baseline in a saved profile', () => {
  it('keeps anchors, the end anchor and sections with their names', () => {
    const alignment = record({
      anchors: [1.5, 3.6, 5.6],
      endAnchor: 7.6,
      sections: [
        { firstBar: 0, lastBar: 1, letter: 'A', name: 'Verse' },
        { firstBar: 2, lastBar: 2, letter: 'B' },
      ],
    });
    expect(normalizeProfile({ ...base, alignment })?.alignment).toEqual(alignment);
  });

  it('covers AE7: a renamed section survives a save and a read', async () => {
    const store = new FileProfileStore(memoryBackend());
    const alignment = {
      source: 'auto' as const,
      holds: [],
      anchors: [1.5, 3.5],
      endAnchor: 5.5,
      sections: [{ firstBar: 0, lastBar: 1, letter: 'A', name: 'Intro riff' }],
    };
    await store.save('h', { version: PROFILE_VERSION, offset: 1.5, alignment });
    expect((await store.load('h'))?.alignment).toEqual(alignment);
  });

  it('drops anchors that are not all numbers, or that have no end anchor, and keeps the rest of the record', () => {
    expect(normalizeProfile({ ...base, alignment: record({ anchors: [1, 'x'], endAnchor: 5 }) })?.alignment).toEqual(record());
    expect(normalizeProfile({ ...base, alignment: record({ anchors: [1, 2] }) })?.alignment).toEqual(record());
    expect(normalizeProfile({ ...base, alignment: record({ anchors: [1, 2], endAnchor: Number.NaN }) })?.alignment).toEqual(record());
  });

  it('drops the whole sections list when one is malformed, overlaps another or is out of order', () => {
    const bad = [
      [{ firstBar: 0, lastBar: 1, letter: 'A' }, { firstBar: 1, lastBar: 3, letter: 'B' }],
      [{ firstBar: 4, lastBar: 5, letter: 'A' }, { firstBar: 0, lastBar: 1, letter: 'B' }],
      [{ firstBar: 0, lastBar: -1, letter: 'A' }],
      [{ firstBar: 0.5, lastBar: 1, letter: 'A' }],
      [{ firstBar: 0, lastBar: 1, letter: '' }],
      ['junk'],
    ];
    for (const sections of bad) expect(normalizeProfile({ ...base, alignment: record({ sections }) })?.alignment).toEqual(record());
  });

  it('keeps a section but drops a name that is not text or is too long', () => {
    const p = normalizeProfile({
      ...base,
      alignment: record({ sections: [{ firstBar: 0, lastBar: 3, letter: 'A', name: 'x'.repeat(200) }, { firstBar: 4, lastBar: 7, letter: 'B', name: 5 }] }),
    });
    expect(p?.alignment?.sections).toEqual([
      { firstBar: 0, lastBar: 3, letter: 'A' },
      { firstBar: 4, lastBar: 7, letter: 'B' },
    ]);
  });

  it('reads a record from before the baseline as it was', () => {
    expect(normalizeProfile({ ...base, alignment: record({ holds: [{ at: 20, length: 8 }] }) })?.alignment).toEqual(
      record({ holds: [{ at: 20, length: 8 }] }),
    );
  });
});
