import { useEffect, useId, useRef, useState } from 'react';
import type { LibraryEntry, LibraryListing } from './library';
import { Menu } from './Menu';

export interface LibraryListProps {
  /** Saved songs, last opened first. */
  songs: readonly LibraryListing[];
  /** Recordings, by content hash, that have saved stems. */
  stemHashes: ReadonlySet<string>;
  /** Reopens a song; false when it could not be opened, so focus goes back to its row. */
  onOpen: (entry: LibraryEntry) => Promise<boolean>;
  /** Removes a song with an undo window (R2); the row menu that calls it comes with U4. */
  onRemove?: (entry: LibraryEntry) => void | Promise<void>;
  /** Renames a song (R1); false when it could not be saved. The row menu that calls it comes with U4. */
  onRename?: (tabHash: string, title: string) => Promise<boolean>;
}

interface Props extends LibraryListProps {
  /** True while every row waits: on the start screen, while a file or song opens; in the Songs menu, under the recording lock. */
  disabled: boolean;
  /** Now, in milliseconds since the epoch, for the last-opened times. */
  now: number;
  /** The open song's tab hash; its row is marked and picking it does nothing (R3). */
  currentTabHash?: string;
  /** Shown as text above the rows, such as why they are disabled or what switching will cancel (R4). */
  notice?: string | null;
  /** Shown when there are no saved songs; without it the list renders nothing then. */
  emptyText?: string;
  /** Renders nothing but keeps the rows' state, such as which song is opening, for when they are shown again. */
  hidden?: boolean;
}

/** What the Songs menu says while stems are being separated; picking a song cancels the separation (R4). */
export const SEPARATION_WARNING = 'Switching will cancel stem separation';

/** Whether picking this row opens its song: the song already open stays as it is (R3). */
export function opensOnPick(tabHash: string, currentTabHash: string | undefined): boolean {
  return tabHash !== currentTabHash;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "Opened 3 days ago", "Opened yesterday", or "Opened just now" within the last minute. */
export function lastOpenedText(openedAt: number, now: number): string {
  const seconds = Math.max(0, (now - openedAt) / 1000);
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return `Opened ${relative.format(-Math.floor(seconds / size), unit)}`;
  }
  return 'Opened just now';
}

/** What a song brings back with it: its stems (or recording) and its video. Empty for a tab alone. */
export function backingText(entry: LibraryEntry, stemHashes: ReadonlySet<string>): string {
  const parts: string[] = [];
  if (entry.recording) parts.push(stemHashes.has(entry.recording.hash) ? 'Stems' : 'Recording');
  if (entry.video) parts.push('Video');
  return parts.join(' · ');
}

/**
 * The saved songs, on the start screen and in the player's Songs menu. Renders nothing when there are none unless given
 * `emptyText`, so the first run looks as it always has.
 */
export function LibraryList({ songs, stemHashes, onOpen, disabled, now, currentTabHash, notice, emptyText, hidden }: Props) {
  const headingId = useId();
  const noticeId = useId();
  const [opening, setOpening] = useState<string | null>(null);
  /** The row whose song could not be opened, to take focus back once the rows are enabled again. */
  const [refocus, setRefocus] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!refocus || disabled) return;
    rows.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus, disabled]);
  if (hidden || (songs.length === 0 && !emptyText)) return null;

  async function open(entry: LibraryEntry) {
    if (!opensOnPick(entry.tabHash, currentTabHash)) return;
    setOpening(entry.tabHash);
    let opened = false;
    try {
      opened = await onOpen(entry);
    } finally {
      setOpening(null);
    }
    // The row was disabled while the song opened and lost focus; give it back so the player can try again or move on.
    if (!opened) setRefocus(entry.tabHash);
  }

  return (
    <section className="library" aria-labelledby={headingId}>
      <h2 id={headingId}>Your songs</h2>
      {notice && (
        <p id={noticeId} className="library-notice" role="status">
          {notice}
        </p>
      )}
      {songs.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
      <ul className="library-list">
        {songs.map(({ entry, title, showFileName }) => {
          const busy = opening === entry.tabHash;
          const current = entry.tabHash === currentTabHash;
          const backing = backingText(entry, stemHashes);
          return (
            <li key={entry.tabHash}>
              <button
                type="button"
                className="library-song"
                ref={(el) => {
                  if (el) rows.current.set(entry.tabHash, el);
                  else rows.current.delete(entry.tabHash);
                }}
                disabled={disabled}
                aria-busy={busy || undefined}
                aria-current={current || undefined}
                aria-describedby={notice ? noticeId : undefined}
                onClick={() => void open(entry)}
              >
                <span className="library-title">{title}</span>
                {showFileName && <span className="library-file">{entry.fileName}</span>}
                <span className="library-meta">
                  <span>{current ? 'Playing now' : busy ? 'Opening…' : lastOpenedText(entry.openedAt, now)}</span>
                  {backing && <span className="library-backing">{backing}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}

interface SongsMenuProps {
  /** The saved songs and how to reopen one; undefined on the web, which has no Songs menu (R1). */
  library?: LibraryListProps;
  /** The open song's tab hash, once its tab is saved. */
  currentTabHash?: string;
  /** Why songs can't be picked right now (the recording lock), or null (R4). */
  lockedReason: string | null;
  /** Whether stems are being separated, which picking a song cancels (R4). */
  separating: boolean;
  /** Called when the menu opens, to read the saved songs again. */
  onMenuOpen: () => void;
}

/** What the Songs menu's list shows while the menu is open, with `now` read when it opened. */
export function songsMenuList(
  library: LibraryListProps,
  { currentTabHash, lockedReason, separating }: Pick<SongsMenuProps, 'currentTabHash' | 'lockedReason' | 'separating'>,
  now: number,
): Props {
  return {
    ...library,
    disabled: lockedReason !== null,
    now,
    currentTabHash,
    notice: lockedReason ?? (separating ? SEPARATION_WARNING : null),
    emptyText: 'No saved songs yet',
  };
}

/**
 * The player's Songs menu: the saved songs, newest first, with the open one marked (R1, KTD7). Desktop only. The rows render
 * only while the menu is open, since the player re-renders many times a second while playing.
 */
export function SongsMenu({ library, currentTabHash, lockedReason, separating, onMenuOpen }: SongsMenuProps) {
  /** When the menu last opened, for the last-opened times; null while it is closed. */
  const openedAt = useRef<number | null>(null);
  if (!library) return null;
  return (
    <Menu label="Songs" ariaLabel="Songs: switch to another saved song" className="songs-menu" onOpen={onMenuOpen}>
      {(open) => {
        openedAt.current = open ? (openedAt.current ?? Date.now()) : null;
        return <LibraryList {...songsMenuList(library, { currentTabHash, lockedReason, separating }, openedAt.current ?? 0)} hidden={!open} />;
      }}
    </Menu>
  );
}
