import { describe, expect, it } from 'vitest';
import { describeEngine } from '../../src/app/engine-state';
import { passNote, scheduleChoice, scheduleForChoice, SCHEDULE_CHOICES, formatDuration, guitarAmount, guitarAmountLabel, setGuitarAmount, rankByLength, searchRow, separateControl, setStemVolume, toggleStemMute, toggleStemSolo, volumeLabel } from '../../src/app/stem-controls';
import { initialMix, stemGains } from '../../src/audio/mix-gains';

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

  it('covers F2: with a file loaded and setup never run, the control is enabled and asking starts setup', () => {
    const c = separateControl({ engine: describeEngine({ phase: 'setup-needed' }), hasRecording: true, hasSaved: false, busy: false });
    expect(c).toMatchObject({ visible: true, disabled: false, startsSetup: true });
    expect(c.note).toMatch(/download/i);
  });

  it('with no file loaded and setup never run, asks for a file first and starts nothing', () => {
    const c = separateControl({ engine: describeEngine({ phase: 'setup-needed' }), hasRecording: false, hasSaved: false, busy: false });
    expect(c).toMatchObject({ disabled: true, startsSetup: false });
  });

  it('stays disabled while setup runs, with the progress in its note, and does not start it again', () => {
    const c = separateControl({ engine: describeEngine({ phase: 'setting-up', progress: 0.25 }), hasRecording: true, hasSaved: false, busy: false });
    expect(c).toMatchObject({ disabled: true, startsSetup: false });
    expect(c.note).toContain('25%');
  });

  it('never starts setup once the engine is ready', () => {
    expect(separateControl({ engine: ready, hasRecording: true, hasSaved: false, busy: false }).startsSetup).toBe(false);
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

describe('R26: guitar amount', () => {
  it('20% gives the guitar gain 0.2 and leaves the other stems unchanged', () => {
    const before = initialMix();
    const after = setGuitarAmount(before, 0.2);
    const g = stemGains(after);
    expect(g.guitar).toBe(0.2);
    expect({ ...g, guitar: 0 }).toEqual({ ...stemGains(before), guitar: 0 });
    expect(after.drums).toEqual(before.drums);
    expect(before.guitar.volume).toBe(1);
    expect(guitarAmount(after)).toBe(0.2);
  });

  it('amount 0 equals the muted-guitar mix (AE5)', () => {
    const zero = stemGains(setGuitarAmount(initialMix(), 0));
    expect(zero).toEqual(stemGains(toggleStemMute(initialMix(), 'guitar')));
  });

  it('clamps to 0..1 and moving off zero unmutes the guitar', () => {
    expect(setGuitarAmount(initialMix(), 3).guitar.volume).toBe(1);
    expect(setGuitarAmount(initialMix(), -1).guitar.volume).toBe(0);
    const muted = toggleStemMute(initialMix(), 'guitar');
    expect(setGuitarAmount(muted, 0.2).guitar.muted).toBe(false);
    expect(setGuitarAmount(muted, 0).guitar.muted).toBe(true);
  });

  it('leaves solo untouched and reads a muted or boosted guitar as its audible amount', () => {
    expect(setGuitarAmount(toggleStemSolo(initialMix(), 'guitar'), 0.2).guitar.solo).toBe(true);
    expect(guitarAmount(toggleStemMute(initialMix(), 'guitar'))).toBe(0);
    expect(guitarAmount(setStemVolume(initialMix(), 'guitar', 1.5))).toBe(1);
  });

  it('labels the amount', () => {
    expect(guitarAmountLabel(0)).toBe('None');
    expect(guitarAmountLabel(0.2)).toBe('20%');
    expect(guitarAmountLabel(1)).toBe('Full');
  });
});

describe('pass schedule choice', () => {
  it('maps each choice to a schedule and back, with a label', () => {
    expect(scheduleForChoice('off')).toEqual({ kind: 'off' });
    expect(scheduleForChoice('fade-out').kind).toBe('fade-out');
    expect(scheduleForChoice('listen-then-play').kind).toBe('listen-then-play');
    expect(scheduleChoice(scheduleForChoice('fade-out'))).toBe('fade-out');
    expect(SCHEDULE_CHOICES.map((c) => c.label)).toEqual(['Off', 'Fade out', 'Listen then play']);
  });

  it('describes the pass in progress', () => {
    expect(passNote({ kind: 'off' }, 3)).toBe('');
    expect(passNote(scheduleForChoice('fade-out'), 2)).toBe('Pass 2: guitar 60%');
    expect(passNote(scheduleForChoice('fade-out'), 6)).toBe('Pass 6: guitar None');
    expect(passNote(scheduleForChoice('listen-then-play'), 1)).toBe('Pass 1: listen to the guitar');
    expect(passNote(scheduleForChoice('listen-then-play'), 2)).toBe('Pass 2: you play the guitar part');
  });
});

describe('rankByLength', () => {
  const item = (url: string, duration: number | null, too_long = false) => ({ url, title: url, duration, uploader: null, too_long });

  it('covers AE2: lists the closest length first and keeps every result', () => {
    const ranked = rankByLength([item('four', 240), item('twelve', 720), item('seven', 420)], 420);
    expect(ranked.map((r) => r.url)).toEqual(['seven', 'four', 'twelve']);
  });

  it('keeps the engine order for results the same distance away', () => {
    const ranked = rankByLength([item('a', 400), item('b', 440), item('c', 400)], 420);
    expect(ranked.map((r) => r.url)).toEqual(['a', 'b', 'c']);
  });

  it('lists a result with no length after every result that has one', () => {
    const ranked = rankByLength([item('none', null), item('far', 1000), item('near', 420)], 420);
    expect(ranked.map((r) => r.url)).toEqual(['near', 'far', 'none']);
  });

  it('keeps a result over the import limit in the list', () => {
    const ranked = rankByLength([item('long', 9000, true), item('near', 400)], 420);
    expect(ranked.map((r) => r.url)).toEqual(['near', 'long']);
    expect(ranked[1].too_long).toBe(true);
  });

  it('returns an empty list for no results and does not change its input', () => {
    expect(rankByLength([], 420)).toEqual([]);
    const input = [item('b', 100), item('a', 420)];
    rankByLength(input, 420);
    expect(input.map((r) => r.url)).toEqual(['b', 'a']);
  });

  it('treats a missing length like an unknown one instead of mis-sorting', () => {
    const odd = { url: 'odd', title: 'odd', uploader: null, too_long: false } as unknown as ReturnType<typeof item>;
    expect(rankByLength([odd, item('near', 420)], 420).map((r) => r.url)).toEqual(['near', 'odd']);
  });

  it('keeps the order when the tab length is unknown', () => {
    expect(rankByLength([item('b', 100), item('a', 420)], 0).map((r) => r.url)).toEqual(['b', 'a']);
  });
});
