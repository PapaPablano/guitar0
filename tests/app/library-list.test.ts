import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DropZone } from '../../src/app/DropZone';
import { listSongs, type LibraryEntry } from '../../src/app/library';
import { backingText, lastOpenedText, LibraryList, opensOnPick, SEPARATION_WARNING, SongsMenu, songsMenuList } from '../../src/app/LibraryList';
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

describe('LibraryList in the Songs menu', () => {
  const A = '1'.repeat(64);
  const B = '2'.repeat(64);
  const two = () => [entry({ tabHash: A, title: 'Alpha', openedAt: NOW - DAY }), entry({ tabHash: B, title: 'Beta', openedAt: NOW })];
  const menuList = (props: { currentTabHash?: string; notice?: string | null; disabled?: boolean; entries?: LibraryEntry[] }) =>
    renderToStaticMarkup(
      createElement(LibraryList, {
        songs: listSongs(props.entries ?? two()),
        stemHashes: new Set<string>(),
        onOpen: open,
        disabled: props.disabled ?? false,
        now: NOW,
        currentTabHash: props.currentTabHash,
        notice: props.notice,
        emptyText: 'No saved songs yet',
      }),
    );
  const rowFor = (out: string, title: string) => {
    const start = out.lastIndexOf('<button', out.indexOf(title));
    return out.slice(start, out.indexOf('</button>', start));
  };

  it('marks the open song, which stays focusable, and leaves the others unmarked (R1)', () => {
    const out = menuList({ currentTabHash: A });
    const current = rowFor(out, 'Alpha');
    expect(current).toContain('aria-current="true"');
    expect(current).toContain('Playing now');
    expect(current).not.toContain('disabled');
    expect(rowFor(out, 'Beta')).not.toContain('aria-current');
    expect(rowFor(out, 'Beta')).not.toContain('Playing now');
  });

  it('does nothing when the open song is picked (R3)', () => {
    expect(opensOnPick(A, A)).toBe(false);
    expect(opensOnPick(B, A)).toBe(true);
    expect(opensOnPick(A, undefined)).toBe(true);
  });

  it('gives each list its own heading id, so the start screen and the menu never share one', () => {
    const out = renderToStaticMarkup(
      createElement('div', null, [
        createElement(LibraryList, { key: 1, songs: listSongs(two()), stemHashes: new Set<string>(), onOpen: open, disabled: false, now: NOW }),
        createElement(LibraryList, { key: 2, songs: listSongs(two()), stemHashes: new Set<string>(), onOpen: open, disabled: false, now: NOW }),
      ]),
    );
    const ids = [...out.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const labelled = [...out.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(labelled).toEqual(ids);
  });

  it('keeps the start screen heading "Your songs"', () => {
    expect(list([entry({})])).toContain('>Your songs</h2>');
  });

  it('shows the recording lock as visible text above disabled rows (R4)', () => {
    const reason = 'Unavailable while a recording with video is being captured.';
    const out = menuList({ notice: reason, disabled: true });
    expect(out).toContain(reason);
    expect(out.indexOf(reason)).toBeLessThan(out.indexOf('<ul'));
    expect(rowFor(out, 'Alpha')).toContain('disabled');
    expect(rowFor(out, 'Beta')).toContain('disabled');
  });

  it('shows the stem separation warning with the rows enabled (R4)', () => {
    const out = menuList({ notice: SEPARATION_WARNING });
    expect(SEPARATION_WARNING).toBe('Switching will cancel stem separation');
    expect(out).toContain(SEPARATION_WARNING);
    expect(out.indexOf(SEPARATION_WARNING)).toBeLessThan(out.indexOf('<ul'));
    expect(out).not.toContain('disabled');
  });

  it('says "No saved songs yet" when the library is empty', () => {
    const out = menuList({ entries: [] });
    expect(out).toContain('No saved songs yet');
    expect(out).not.toContain('<button');
  });
});

describe('SongsMenu', () => {
  const riff = { songs: listSongs([entry({ title: 'Riff' })]), stemHashes: new Set<string>(), onOpen: open };
  const songsMenu = (props: Partial<Parameters<typeof SongsMenu>[0]>) =>
    renderToStaticMarkup(
      createElement(SongsMenu, {
        library: riff,
        lockedReason: null,
        separating: false,
        onMenuOpen: () => {},
        ...props,
      }),
    );
  /** The list the menu shows once it is open. */
  const openMenu = (props: Partial<Parameters<typeof songsMenuList>[1]> = {}, library = riff) =>
    renderToStaticMarkup(createElement(LibraryList, songsMenuList(library, { lockedReason: null, separating: false, ...props }, NOW)));

  it('is not shown on the web (R1)', () => {
    expect(songsMenu({ library: undefined })).toBe('');
  });

  it('is a menu labelled "Songs" listing the saved songs on the desktop (R1)', () => {
    const out = songsMenu({});
    expect(out).toContain('<details');
    expect(out).toMatch(/<summary[^>]*>Songs<\/summary>/);
    expect(openMenu()).toContain('Riff');
  });

  it('renders its rows only while open, so the player re-rendering while it plays does not redraw a hidden list', () => {
    const out = songsMenu({});
    expect(out).not.toContain('Riff');
    expect(out).not.toContain('Your songs');
  });

  it('dates the rows from the moment the menu opened', () => {
    const out = openMenu({}, { ...riff, songs: listSongs([entry({ title: 'Riff', openedAt: NOW - 3 * DAY })]) });
    expect(out).toContain('Opened 3 days ago');
  });

  it('keeps its rows enabled while a song opens; only the recording lock disables them (R11)', () => {
    // The menu has no "opening" input at all: a song opening elsewhere never reaches its rows.
    expect(openMenu()).not.toContain('disabled');
    expect(openMenu({ separating: true })).not.toContain('disabled');
    expect(openMenu({ lockedReason: 'Busy recording.' })).toContain('disabled');
  });

  it('prefers the recording lock over the separation warning, since nothing can be picked then', () => {
    const out = openMenu({ lockedReason: 'Busy recording.', separating: true });
    expect(out).toContain('Busy recording.');
    expect(out).not.toContain(SEPARATION_WARNING);
  });

  it('says "No saved songs yet" with an empty library', () => {
    expect(openMenu({}, { songs: [], stemHashes: new Set<string>(), onOpen: open })).toContain('No saved songs yet');
  });
});

describe('LibraryList hidden', () => {
  it('renders nothing while hidden, even with songs or empty text', () => {
    const songs = listSongs([entry({ title: 'Riff' })]);
    const hidden = (s: typeof songs) =>
      renderToStaticMarkup(createElement(LibraryList, { songs: s, stemHashes: new Set<string>(), onOpen: open, disabled: false, now: NOW, emptyText: 'None', hidden: true }));
    expect(hidden(songs)).toBe('');
    expect(hidden([])).toBe('');
  });
});

describe('DropZone', () => {
  const zone = (library?: Parameters<typeof DropZone>[0]['library'], loading = false, loadingText?: string) =>
    renderToStaticMarkup(createElement(DropZone, { onFile: () => {}, onSample: () => {}, error: null, loading, library, loadingText }));

  it('shows no library on the web (R17)', () => {
    expect(zone()).not.toContain('Your songs');
  });

  it('shows the saved songs on the desktop, and names the song while it opens', () => {
    const out = zone({ songs: listSongs([entry({ title: 'Riff' })]), stemHashes: new Set<string>(), onOpen: open }, true, 'Opening Riff…');
    expect(out).toContain('Your songs');
    expect(out).toContain('Opening Riff…');
  });
});
