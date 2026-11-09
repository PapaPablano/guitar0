import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DropZone } from '../../src/app/DropZone';
import { listSongs, TITLE_MAX, type LibraryEntry } from '../../src/app/library';
import type { FileCheck } from '../../src/app/library-shell';
import type { PendingRemoval } from '../../src/app/library-removals';
import {
  backingText,
  createNoticeHold,
  createRenameEdits,
  focusAfterRemove,
  lastOpenedText,
  LibraryList,
  MAX_NOTICES,
  opensOnPick,
  REPAIR_HINT,
  RenameInput,
  renameKeyDown,
  rowAvailability,
  SEPARATION_WARNING,
  SET_ASIDE_TEXT,
  SetAsideMessage,
  songBadges,
  SongsMenu,
  songsMenuList,
  UndoNotices,
} from '../../src/app/LibraryList';
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
    expect(out.match(/class="library-song"/g)).toHaveLength(2);
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

describe('Row menus (KTD8)', () => {
  const A = '1'.repeat(64);
  const B = '2'.repeat(64);
  const C = '3'.repeat(64);
  type ListProps = Parameters<typeof LibraryList>[0];
  const render = (entries: LibraryEntry[], props: Partial<ListProps> = {}) =>
    renderToStaticMarkup(createElement(LibraryList, { songs: listSongs(entries), stemHashes: new Set<string>(), onOpen: open, disabled: false, now: NOW, ...props }));
  /** One row's `<li>`, found by its song's title. */
  const rowFor = (out: string, title: string) => {
    const start = out.lastIndexOf('<li', out.indexOf(`>${title}<`));
    return out.slice(start, out.indexOf('</li>', start));
  };
  const songButton = (row: string) => row.slice(row.indexOf('<button'), row.indexOf('</button>') + '</button>'.length);
  const menuOf = (row: string) => row.slice(row.indexOf('<details'), row.indexOf('</details>'));
  const button = (html: string, label: string) => {
    const end = html.indexOf(`>${label}</button>`);
    return end < 0 ? null : html.slice(html.lastIndexOf('<button', end), end);
  };

  it('puts each row menu beside the row button, not inside it, labelled with the song name', () => {
    const out = render([entry({ tabHash: A, title: 'Alpha' })]);
    const row = rowFor(out, 'Alpha');
    expect(songButton(row)).not.toContain('<details');
    expect(row.indexOf('</button>')).toBeLessThan(row.indexOf('<details'));
    expect(menuOf(row)).toContain('aria-label="Actions for Alpha"');
    expect(menuOf(row)).toContain('⋯');
    expect(button(menuOf(row), 'Rename')).not.toBeNull();
    expect(button(menuOf(row), 'Remove')).not.toBeNull();
  });

  it('names a renamed song by its new name, in the row and its menu label (R1)', () => {
    const out = render([entry({ tabHash: A, title: 'Alpha', customTitle: 'Warmup' })]);
    expect(out).toContain('>Warmup<');
    expect(out).toContain('aria-label="Actions for Warmup"');
    expect(out).not.toContain('>Alpha<');
  });

  it('marks the row menu as the nested one, whose clicks stay inside it so the Songs menu stays open', () => {
    // The opt-out itself is Menu's keepParentOpen (menuPanelClick in menu.test.ts); the row menu is the Menu that uses it.
    const out = render([entry({ tabHash: A, title: 'Alpha' })]);
    expect(menuOf(rowFor(out, 'Alpha'))).toContain('class="menu row-menu"');
  });

  describe('badges (R8, R9)', () => {
    const rec = { hash: 'c'.repeat(64), name: 'take.mp3', type: 'audio/mpeg', extension: 'mp3' };
    const checks = (map: Record<string, FileCheck>) => new Map(Object.entries(map));

    it('reads missing files from the list-load check and damaged ones from the session set', () => {
      const e = entry({ tabHash: A, recording: rec });
      expect(songBadges(e, undefined, new Set())).toEqual([]);
      expect(songBadges(e, { tab: 'ok', recording: 'ok' }, new Set())).toEqual([]);
      expect(songBadges(e, { tab: 'missing', recording: 'ok' }, new Set())).toEqual(['Tab missing']);
      expect(songBadges(e, { tab: 'ok', recording: 'missing' }, new Set())).toEqual(['Recording missing']);
      expect(songBadges(e, { tab: 'ok', recording: 'ok' }, new Set([A]))).toEqual(['Tab damaged']);
      expect(songBadges(e, { tab: 'ok', recording: 'ok' }, new Set([rec.hash]))).toEqual(['Recording damaged']);
      // a file that went missing after it was found damaged is missing
      expect(songBadges(e, { tab: 'missing', recording: 'missing' }, new Set([A, rec.hash]))).toEqual(['Tab missing', 'Recording missing']);
    });

    it('renders each badge on its row', () => {
      const out = render(
        [
          entry({ tabHash: A, title: 'Alpha', recording: rec }),
          entry({ tabHash: B, title: 'Beta', recording: { ...rec, hash: 'd'.repeat(64) } }),
          entry({ tabHash: C, title: 'Gamma' }),
        ],
        { fileChecks: checks({ [A]: { tab: 'missing', recording: 'ok' }, [B]: { tab: 'ok', recording: 'missing' } }), damaged: new Set([C]) },
      );
      expect(rowFor(out, 'Alpha')).toContain('Tab missing');
      expect(rowFor(out, 'Beta')).toContain('Recording missing');
      expect(rowFor(out, 'Gamma')).toContain('Tab damaged');
    });

    it('makes a Tab missing or Tab damaged row inert, with only Remove and the repair hint in its menu', () => {
      const out = render([entry({ tabHash: A, title: 'Alpha' }), entry({ tabHash: B, title: 'Beta' })], {
        fileChecks: checks({ [A]: { tab: 'missing', recording: null } }),
        damaged: new Set([B]),
      });
      for (const title of ['Alpha', 'Beta']) {
        const row = rowFor(out, title);
        expect(songButton(row)).toContain('disabled');
        expect(button(menuOf(row), 'Rename')).toBeNull();
        expect(button(menuOf(row), 'Remove')).not.toContain('disabled');
        expect(menuOf(row)).toContain(REPAIR_HINT);
      }
      expect(REPAIR_HINT).toBe('Load the original file again to repair it');
    });

    it('keeps a damaged-recording row openable, with the hint in its menu; a missing recording has no hint', () => {
      const out = render([entry({ tabHash: A, title: 'Alpha', recording: rec }), entry({ tabHash: B, title: 'Beta', recording: { ...rec, hash: 'd'.repeat(64) } })], {
        fileChecks: checks({ [B]: { tab: 'ok', recording: 'missing' } }),
        damaged: new Set([rec.hash]),
      });
      const alpha = rowFor(out, 'Alpha');
      expect(alpha).toContain('Recording damaged');
      expect(songButton(alpha)).not.toContain('disabled');
      expect(button(menuOf(alpha), 'Rename')).not.toBeNull();
      expect(menuOf(alpha)).toContain(REPAIR_HINT);
      expect(menuOf(rowFor(out, 'Beta'))).not.toContain(REPAIR_HINT);
    });
  });

  describe('availability (KTD8 table)', () => {
    it('idle: every row opens, renames and removes', () => {
      expect(rowAvailability({ disabled: false, current: false, recordLocked: false, badges: [] })).toEqual({ open: true, rename: true, remove: true, hint: false });
      expect(rowAvailability({ disabled: false, current: true, recordLocked: false, badges: [] })).toEqual({ open: true, rename: true, remove: true, hint: false });
    });

    it('a file opening on the start screen: rows disabled, Rename and Remove still offered', () => {
      expect(rowAvailability({ disabled: true, current: false, recordLocked: false, badges: [] })).toEqual({ open: false, rename: true, remove: true, hint: false });
    });

    it('recording with video: the open song keeps Rename but not Remove; other rows are locked but keep both', () => {
      expect(rowAvailability({ disabled: true, current: true, recordLocked: true, badges: [] })).toEqual({ open: false, rename: true, remove: false, hint: false });
      expect(rowAvailability({ disabled: true, current: false, recordLocked: true, badges: [] })).toEqual({ open: false, rename: true, remove: true, hint: false });
    });

    it('in the Songs menu under the recording lock, the open song’s Remove is disabled and the others are not (R5)', () => {
      const library = { songs: listSongs([entry({ tabHash: A, title: 'Alpha', openedAt: NOW - DAY }), entry({ tabHash: B, title: 'Beta' })]), stemHashes: new Set<string>(), onOpen: open };
      const out = renderToStaticMarkup(createElement(LibraryList, songsMenuList(library, { currentTabHash: A, lockedReason: 'Busy recording.', separating: false }, NOW)));
      expect(button(menuOf(rowFor(out, 'Alpha')), 'Remove')).toContain('disabled');
      expect(button(menuOf(rowFor(out, 'Alpha')), 'Rename')).not.toContain('disabled');
      expect(button(menuOf(rowFor(out, 'Beta')), 'Remove')).not.toContain('disabled');
      expect(songButton(rowFor(out, 'Beta'))).toContain('disabled');
      // without the lock the open song can be removed
      const free = renderToStaticMarkup(createElement(LibraryList, songsMenuList(library, { currentTabHash: A, lockedReason: null, separating: false }, NOW)));
      expect(button(menuOf(rowFor(free, 'Alpha')), 'Remove')).not.toContain('disabled');
    });

    it('a song opening from the start screen leaves the rows enabled; a file opening disables them', () => {
      const library = { songs: listSongs([entry({ tabHash: A, title: 'Alpha' })]), stemHashes: new Set<string>(), onOpen: open };
      const zone = (songOpening: boolean) =>
        renderToStaticMarkup(createElement(DropZone, { onFile: () => {}, onSample: () => {}, error: null, loading: true, library, songOpening }));
      expect(songButton(rowFor(zone(true), 'Alpha'))).not.toContain('disabled');
      expect(songButton(rowFor(zone(false), 'Alpha'))).toContain('disabled');
      expect(button(menuOf(rowFor(zone(false), 'Alpha')), 'Remove')).not.toContain('disabled');
    });
  });

  it('moves focus after Remove to the next row, else the previous, else the heading', () => {
    expect(focusAfterRemove([A, B, C], A)).toBe(B);
    expect(focusAfterRemove([A, B, C], B)).toBe(C);
    expect(focusAfterRemove([A, B, C], C)).toBe(B);
    expect(focusAfterRemove([A], A)).toBeNull();
  });

  it('lets the heading take focus when the last song goes', () => {
    expect(render([entry({ tabHash: A, title: 'Alpha' })])).toMatch(/<h2 id="[^"]+" tabindex="-1">Your songs<\/h2>/);
  });
});

describe('Rename edits (R1, KTD8)', () => {
  const A = '1'.repeat(64);
  const setup = () => {
    const save = vi.fn();
    const refocus = vi.fn();
    const changed = vi.fn();
    const edits = createRenameEdits({ save, refocus, changed });
    return { save, refocus, changed, edits };
  };
  const key = (k: string) => ({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() });

  it('starts with the shown name and saves the typed one on Enter, focusing the row menu again', () => {
    const { save, refocus, changed, edits } = setup();
    edits.start(A, 'Alpha');
    expect(edits.current).toEqual({ tabHash: A, shown: 'Alpha', draft: 'Alpha' });
    expect(changed).toHaveBeenLastCalledWith(edits.current);
    edits.change('Warmup');
    const enter = key('Enter');
    renameKeyDown(enter, edits);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(A, 'Warmup');
    expect(refocus).toHaveBeenCalledWith(A);
    expect(edits.current).toBeNull();
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it('cancels on Escape and stops the key from reaching any Menu, so the Songs menu stays open', () => {
    const { save, refocus, edits } = setup();
    edits.start(A, 'Alpha');
    edits.change('Nope');
    const escape = key('Escape');
    renameKeyDown(escape, edits);
    expect(escape.stopPropagation).toHaveBeenCalled();
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(refocus).toHaveBeenCalledWith(A);
    expect(edits.current).toBeNull();
  });

  it('saves on blur without moving focus from where the player clicked', () => {
    const { save, refocus, edits } = setup();
    edits.start(A, 'Alpha');
    edits.change('Warmup');
    edits.finish('blur');
    expect(save).toHaveBeenCalledWith(A, 'Warmup');
    expect(refocus).not.toHaveBeenCalled();
  });

  it('saves an edit in progress when the Songs menu closes, once, even if a blur follows', () => {
    const { save, edits } = setup();
    edits.start(A, 'Alpha');
    edits.change('Warmup');
    edits.finish('close');
    edits.finish('blur');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(A, 'Warmup');
  });

  it('saves nothing when the name is unchanged, and an emptied name to bring back the tab title', () => {
    const { save, edits } = setup();
    edits.start(A, 'Alpha');
    edits.change('  Alpha ');
    edits.finish('enter');
    expect(save).not.toHaveBeenCalled();
    edits.start(A, 'Warmup');
    edits.change('   ');
    edits.finish('enter');
    expect(save).toHaveBeenCalledWith(A, '');
  });

  it('caps the typed name at 120 characters', () => {
    const { save, edits } = setup();
    expect(TITLE_MAX).toBe(120);
    edits.start(A, 'Alpha');
    edits.change('x'.repeat(200));
    expect(edits.current?.draft).toHaveLength(TITLE_MAX);
    edits.finish('enter');
    expect(save).toHaveBeenCalledWith(A, 'x'.repeat(TITLE_MAX));
  });

  it('saves the open edit before starting another', () => {
    const { save, edits } = setup();
    edits.start(A, 'Alpha');
    edits.change('Warmup');
    edits.start('2'.repeat(64), 'Beta');
    expect(save).toHaveBeenCalledWith(A, 'Warmup');
    expect(edits.current?.tabHash).toBe('2'.repeat(64));
  });

  it('ignores other keys', () => {
    const { save, edits } = setup();
    edits.start(A, 'Alpha');
    const other = key('a');
    renameKeyDown(other, edits);
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(other.stopPropagation).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(edits.current).not.toBeNull();
  });

  it('renders the input with the cap and a label naming the song', () => {
    const out = renderToStaticMarkup(
      createElement(RenameInput, { edit: { tabHash: A, shown: 'Alpha', draft: 'Alpha' }, onChange: () => {}, onKeyDown: () => {}, onBlur: () => {} }),
    );
    expect(out).toContain(`maxLength="${TITLE_MAX}"`);
    expect(out).toContain('aria-label="Rename Alpha"');
    expect(out).toContain('value="Alpha"');
  });
});

describe('Undo notices (R2, KTD8)', () => {
  const hash = (n: number) => String(n).repeat(64);
  const pending = (n: number): PendingRemoval => ({ tabHash: hash(n), entry: entry({ tabHash: hash(n), title: `Song ${n}` }), paused: false });
  const notices = (items: PendingRemoval[]) =>
    renderToStaticMarkup(createElement(UndoNotices, { items, onUndo: () => {}, onPause: () => {}, onResume: () => {} }));

  it('shows "Removed <name>. Undo" in one status stack', () => {
    const out = notices([pending(1)]);
    expect(out).toContain('role="status"');
    expect(out).toContain('Removed Song 1.');
    expect(out).toMatch(/<button[^>]*>Undo<\/button>/);
  });

  it('names a renamed song by its custom title', () => {
    const item = { ...pending(1), entry: entry({ tabHash: hash(1), title: 'Song 1', customTitle: 'Warmup' }) };
    expect(notices([item])).toContain('Removed Warmup.');
  });

  it('shows at most 3, newest first, as the removals list gives them', () => {
    expect(MAX_NOTICES).toBe(3);
    const out = notices([pending(5), pending(4), pending(3), pending(2), pending(1)]);
    expect(out.match(/>Undo</g)).toHaveLength(3);
    expect(out.indexOf('Song 5')).toBeLessThan(out.indexOf('Song 4'));
    expect(out.indexOf('Song 4')).toBeLessThan(out.indexOf('Song 3'));
    expect(out).not.toContain('Song 2');
  });

  it('keeps the empty status region in place, so the first notice is announced', () => {
    expect(notices([])).toContain('role="status"');
    expect(notices([])).not.toContain('Undo');
  });

  it('pauses on hover or focus and resumes only once both have left', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const hold = createNoticeHold(pause, resume);
    hold.enter();
    hold.focus();
    expect(pause).toHaveBeenCalledTimes(1);
    hold.leave();
    expect(resume).not.toHaveBeenCalled();
    hold.blur();
    expect(resume).toHaveBeenCalledTimes(1);
    hold.focus();
    hold.blur();
    expect(pause).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('lets go of a held timer when its notice goes, such as when newer notices push it out of the stack', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const hold = createNoticeHold(pause, resume);
    hold.release();
    expect(resume).not.toHaveBeenCalled();
    hold.enter();
    hold.release();
    expect(resume).toHaveBeenCalledTimes(1);
  });
});

describe('Set-aside message (R10)', () => {
  it('names library.json.bad and can be dismissed', () => {
    const out = renderToStaticMarkup(createElement(SetAsideMessage, { onDismiss: () => {} }));
    expect(SET_ASIDE_TEXT).toContain('library.json.bad');
    expect(out).toContain('library.json.bad');
    expect(out).toMatch(/<button[^>]*>Dismiss<\/button>/);
  });

  it('shows on the start screen only when the library file was set aside; the undo notices sit under the actions', () => {
    const zone = (setAside: boolean) =>
      renderToStaticMarkup(
        createElement(DropZone, {
          onFile: () => {},
          onSample: () => {},
          error: null,
          loading: false,
          library: { songs: listSongs([entry({ title: 'Riff' })]), stemHashes: new Set<string>(), onOpen: open },
          setAside: setAside ? { onDismiss: () => {} } : null,
          undoNotices: createElement('div', { className: 'undo-marker' }),
        }),
      );
    expect(zone(false)).not.toContain('library.json.bad');
    const out = zone(true);
    expect(out).toContain('library.json.bad');
    expect(out.indexOf('Try the sample riff')).toBeLessThan(out.indexOf('undo-marker'));
    expect(out.indexOf('undo-marker')).toBeLessThan(out.indexOf('Your songs'));
  });
});
