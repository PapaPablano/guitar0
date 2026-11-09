import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DropZone } from '../../src/app/DropZone';
import { listSongs, type LibraryEntry } from '../../src/app/library';
import { backingText, lastOpenedText, LibraryList } from '../../src/app/LibraryList';
import { FILE_TUNING } from '../../src/model/retune';

const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;

function entry(patch: Partial<LibraryEntry>): LibraryEntry {
  return {
    tabHash: 'a'.repeat(64),
    title: 'Song',
    fileName: 'song.gp',
    fingerprint: '4:00000000',
    openedAt: NOW,
    recording: null,
    video: null,
    source: null,
    trackIndex: 0,
    tuningId: FILE_TUNING,
    ...patch,
  };
}

const recording = { hash: 'c'.repeat(64), name: 'take.mp3', type: 'audio/mpeg', extension: 'mp3' };
const open = async () => true;

const list = (entries: LibraryEntry[], disabled = false, stemHashes: ReadonlySet<string> = new Set()) =>
  renderToStaticMarkup(createElement(LibraryList, { songs: listSongs(entries), stemHashes, onOpen: open, disabled, now: NOW }));

describe('lastOpenedText', () => {
  it('reads as a relative time', () => {
    expect(lastOpenedText(NOW - 10_000, NOW)).toBe('Opened just now');
    expect(lastOpenedText(NOW - 5 * 60_000, NOW)).toBe('Opened 5 minutes ago');
    expect(lastOpenedText(NOW - DAY, NOW)).toBe('Opened yesterday');
    expect(lastOpenedText(NOW - 3 * DAY, NOW)).toBe('Opened 3 days ago');
    expect(lastOpenedText(NOW - 400 * DAY, NOW)).toBe('Opened last year');
  });

  it('treats a time in the future (a clock moved back) as just now', () => {
    expect(lastOpenedText(NOW + DAY, NOW)).toBe('Opened just now');
  });
});

describe('backingText', () => {
  it('names the recording, its stems when saved, and the video', () => {
    expect(backingText(entry({}), new Set())).toBe('');
    expect(backingText(entry({ recording }), new Set())).toBe('Recording');
    expect(backingText(entry({ recording }), new Set([recording.hash]))).toBe('Stems');
    expect(backingText(entry({ recording, video: { videoId: 'v', offsetSeconds: 0 } }), new Set())).toBe('Recording · Video');
  });
});

describe('LibraryList', () => {
  it('renders nothing with no saved songs, so the first run looks as it does today', () => {
    expect(list([])).toBe('');
  });

  it('lists songs last opened first as buttons under "Your songs"', () => {
    const out = list([
      entry({ tabHash: '1'.repeat(64), title: 'Older', openedAt: NOW - 2 * DAY }),
      entry({ tabHash: '2'.repeat(64), title: 'Newer', openedAt: NOW - 60_000 }),
    ]);
    expect(out).toContain('Your songs');
    expect(out.indexOf('Newer')).toBeLessThan(out.indexOf('Older'));
    expect(out.match(/<button/g)).toHaveLength(2);
    expect(out).toContain('Opened 2 days ago');
  });

  it('shows the file name only when titles collide (R7)', () => {
    const out = list([
      entry({ tabHash: '1'.repeat(64), title: 'Same', fileName: 'one.gp' }),
      entry({ tabHash: '2'.repeat(64), title: 'Same', fileName: 'two.gp' }),
      entry({ tabHash: '3'.repeat(64), title: 'Alone', fileName: 'alone.gp' }),
    ]);
    expect(out).toContain('one.gp');
    expect(out).toContain('two.gp');
    expect(out).not.toContain('alone.gp');
  });

  it('disables every row while something is loading', () => {
    expect(list([entry({})], true)).toContain('disabled');
    expect(list([entry({})], false)).not.toContain('disabled');
  });
});

describe('DropZone', () => {
  const zone = (library?: Parameters<typeof DropZone>[0]['library'], loading = false, loadingText?: string) =>
    renderToStaticMarkup(createElement(DropZone, { onFile: () => {}, onSample: () => {}, error: null, loading, library, loadingText }));

  it('shows no library on the web (R17)', () => {
    expect(zone()).not.toContain('Your songs');
  });

  it('shows the saved songs on the desktop, and names the song while it opens', () => {
    const out = zone({ songs: listSongs([entry({ title: 'Riff' })]), stemHashes: new Set(), onOpen: open }, true, 'Opening Riff…');
    expect(out).toContain('Your songs');
    expect(out).toContain('Opening Riff…');
  });
});
