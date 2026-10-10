import { describe, expect, it } from 'vitest';
import { canSwitchTone, GUITAR_TONES, isGuitarProgram, programForTone, programOverrides, toneOfProgram } from '../../src/audio/guitar-tone';

describe('guitar tones', () => {
  it('maps the three tones to General MIDI clean, overdrive and distortion guitar', () => {
    expect(programForTone('clean')).toBe(27);
    expect(programForTone('crunch')).toBe(29);
    expect(programForTone('distortion')).toBe(30);
    expect(GUITAR_TONES.map((t) => t.label)).toEqual(['Clean', 'Crunch', 'Distortion']);
  });

  it('reads 27, 29 and 30 back as tones and any other program as none', () => {
    expect(toneOfProgram(27)).toBe('clean');
    expect(toneOfProgram(29)).toBe('crunch');
    expect(toneOfProgram(30)).toBe('distortion');
    for (const other of [0, 24, 25, 26, 28, 31, 33, 48]) expect(toneOfProgram(other)).toBeNull();
  });

  it('counts programs 24 to 31 as guitars, and bass, keys and strings as not', () => {
    for (const guitar of [24, 26, 27, 28, 29, 30, 31]) expect(isGuitarProgram(guitar)).toBe(true);
    for (const other of [0, 23, 32, 33, 48, 118]) expect(isGuitarProgram(other)).toBe(false);
  });

  it('lists only the tracks that have a chosen tone', () => {
    expect([...programOverrides({ 2: 'distortion', 0: 'clean' })].sort()).toEqual([
      [0, 27],
      [2, 30],
    ]);
    expect(programOverrides({}).size).toBe(0);
  });

  it('shows the tone switch for a guitar track while the synth is heard, and for nothing else', () => {
    const guitar = { isPercussion: false, program: 30 };
    expect(canSwitchTone(guitar, false)).toBe(true);
    expect(canSwitchTone({ isPercussion: false, program: 25 }, false)).toBe(true);
    expect(canSwitchTone(guitar, true)).toBe(false);
    expect(canSwitchTone({ isPercussion: true, program: 30 }, false)).toBe(false);
    expect(canSwitchTone({ isPercussion: false, program: 33 }, false)).toBe(false);
    expect(canSwitchTone(undefined, false)).toBe(false);
  });
});
