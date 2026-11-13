import { describe, expect, it } from 'vitest';
import { readSynthEffects, SYNTH_EFFECTS_KEY, writeSynthEffects } from '../../src/app/effects-setting';
import type { ProfileStorage } from '../../src/audio/profile-store-web';

function memory(initial: Record<string, string> = {}): ProfileStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (key) => data[key] ?? null, setItem: (key, value) => void (data[key] = value) };
}

describe('the synth effects setting', () => {
  it('is on when nothing has been saved', () => {
    expect(readSynthEffects(memory())).toBe(true);
  });

  it('survives a reload: off is still off when read again, and on is on', () => {
    const storage = memory();
    writeSynthEffects(false, storage);
    expect(storage.data[SYNTH_EFFECTS_KEY]).toBe('off');
    expect(readSynthEffects(storage)).toBe(false);
    writeSynthEffects(true, storage);
    expect(readSynthEffects(storage)).toBe(true);
  });

  it('reads anything that is not a saved off as on', () => {
    for (const junk of ['', 'maybe', 'false', '0', '{"x":1}']) expect(readSynthEffects(memory({ [SYNTH_EFFECTS_KEY]: junk }))).toBe(true);
  });

  it('is on, and never throws, when storage is missing, blocked on read, or blocked on write', () => {
    expect(readSynthEffects(null)).toBe(true);
    const hostile: ProfileStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readSynthEffects(hostile)).toBe(true);
    // A failed write only means the choice is not kept; the switch itself is the caller's state and keeps working.
    expect(() => writeSynthEffects(false, hostile)).not.toThrow();
    expect(() => writeSynthEffects(false, null)).not.toThrow();
  });
});
