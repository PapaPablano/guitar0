import { describe, expect, it } from 'vitest';
import { describeEngine } from '../../src/app/engine-state';
import { separateControl, setStemVolume, toggleStemMute, toggleStemSolo } from '../../src/app/stem-controls';
import { initialMix } from '../../src/audio/mix-gains';

const ready = describeEngine({ phase: 'ready', url: 'http://127.0.0.1:1', secret: 's' });

describe('separateControl', () => {
  it('covers R2: renders nothing on the web', () => {
    expect(separateControl({ engine: describeEngine(null), hasRecording: true, hasSaved: false, busy: false }).visible).toBe(false);
  });

  it('offers Separate when ready with a recording and no saved stems', () => {
    const c = separateControl({ engine: ready, hasRecording: true, hasSaved: false, busy: false });
    expect(c).toMatchObject({ visible: true, label: 'Separate', disabled: false });
  });

  it('offers saved stems instead when they exist', () => {
    const c = separateControl({ engine: ready, hasRecording: true, hasSaved: true, busy: false });
    expect(c).toMatchObject({ visible: true, label: 'Use saved stems', disabled: false });
  });

  it('asks for a recording first', () => {
    const c = separateControl({ engine: ready, hasRecording: false, hasSaved: false, busy: false });
    expect(c.disabled).toBe(true);
    expect(c.note).toMatch(/recording/i);
  });

  it('is disabled with the setup message while setup is unfinished', () => {
    const c = separateControl({ engine: describeEngine({ phase: 'setup-failed', message: 'No network' }), hasRecording: true, hasSaved: false, busy: false });
    expect(c.visible).toBe(true);
    expect(c.disabled).toBe(true);
    expect(c.note).toContain('No network');
  });

  it('is disabled while a separation runs', () => {
    expect(separateControl({ engine: ready, hasRecording: true, hasSaved: false, busy: true }).disabled).toBe(true);
  });
});

describe('mix changes', () => {
  it('toggling mute changes only that stem and returns a new object', () => {
    const before = initialMix();
    const after = toggleStemMute(before, 'guitar');
    expect(after.guitar.muted).toBe(true);
    expect(after.drums).toEqual(before.drums);
    expect(before.guitar.muted).toBe(false);
    expect(toggleStemMute(after, 'guitar').guitar.muted).toBe(false);
  });

  it('toggles solo and sets volume on one stem', () => {
    expect(toggleStemSolo(initialMix(), 'bass').bass.solo).toBe(true);
    const v = setStemVolume(initialMix(), 'piano', 0.3);
    expect(v.piano.volume).toBe(0.3);
    expect(v.other.volume).toBe(1);
    expect(setStemVolume(initialMix(), 'piano', 5).piano.volume).toBe(1);
  });
});
