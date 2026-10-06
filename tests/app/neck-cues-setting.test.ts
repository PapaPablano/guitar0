import { describe, expect, it } from 'vitest';
import { NECK_CUES_KEY, readNeckCues, writeNeckCues } from '../../src/app/neck-cues-setting';
import type { ProfileStorage } from '../../src/audio/profile-store-web';

function memory(initial: Record<string, string> = {}): ProfileStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

describe('the neck cues setting', () => {
  it('is on when nothing has been saved', () => {
    expect(readNeckCues(memory())).toBe(true);
  });

  it('covers AE6: a choice of off is still off when read again, and on is on', () => {
    const storage = memory();
    writeNeckCues(false, storage);
    expect(readNeckCues(storage)).toBe(false);
    writeNeckCues(true, storage);
    expect(readNeckCues(storage)).toBe(true);
  });

  it('reads anything that is not a saved off as on', () => {
    for (const junk of ['', 'maybe', 'false', '0', '{"x":1}']) expect(readNeckCues(memory({ [NECK_CUES_KEY]: junk }))).toBe(true);
  });

  it('is on, and never throws, when storage is missing, blocked on read, or blocked on write', () => {
    expect(readNeckCues(null)).toBe(true);
    const hostile: ProfileStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readNeckCues(hostile)).toBe(true);
    expect(() => writeNeckCues(false, hostile)).not.toThrow();
    expect(() => writeNeckCues(false, null)).not.toThrow();
  });
});
