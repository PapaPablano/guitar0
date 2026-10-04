import { describe, expect, it } from 'vitest';
import { describeEngine } from '../../src/app/engine-state';
import { formatDuration, searchRow, separateControl, setStemVolume, toggleStemMute, toggleStemSolo, volumeLabel } from '../../src/app/stem-controls';
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
    expect(setStemVolume(initialMix(), 'piano', 1.4).piano.volume).toBe(1.4);
    expect(setStemVolume(initialMix(), 'piano', 5).piano.volume).toBe(2);
    expect(setStemVolume(initialMix(), 'piano', -3).piano.volume).toBe(0);
  });
});

describe('volumeLabel', () => {
  it('shows a percentage, with 100% as the original level', () => {
    expect(volumeLabel(1)).toBe('100%');
    expect(volumeLabel(0)).toBe('0%');
    expect(volumeLabel(1.5)).toBe('150%');
    expect(volumeLabel(0.333)).toBe('33%');
  });
});

describe('formatDuration', () => {
  it('formats minutes, hours and unknown lengths', () => {
    expect(formatDuration(185)).toBe('3:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(null)).toBe('');
  });
});

describe('searchRow', () => {
  it('shows title, uploader and length', () => {
    const r = searchRow({ url: 'u', title: 'Song', duration: 200, uploader: 'Band', too_long: false });
    expect(r).toEqual({ title: 'Song', detail: 'Band · 3:20', disabled: false, note: '' });
  });

  it('disables a result over the engine length limit and says why', () => {
    const r = searchRow({ url: 'u', title: 'Mix', duration: 9000, uploader: null, too_long: true });
    expect(r.disabled).toBe(true);
    expect(r.note).toMatch(/too long/i);
    expect(r.detail).toBe('2:30:00');
  });
});

describe('R25: stem controls during setup', () => {
  it('disables Separate with an explanation while setting up, including with an unknown progress', () => {
    const engine = describeEngine({ phase: 'setting-up', progress: null, message: 'Downloading the separation models' });
    const c = separateControl({ engine, hasRecording: true, hasSaved: true, busy: false });
    expect(c).toMatchObject({ visible: true, disabled: true });
    expect(c.note).toContain('Downloading the separation models');
  });
});
