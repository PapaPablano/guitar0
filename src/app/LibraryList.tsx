import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { cleanTitle, displayTitle, TITLE_MAX, type LibraryEntry, type LibraryListing } from './library';
import type { PendingRemoval } from './library-removals';
import type { FileCheck } from './library-shell';
import { Menu } from './Menu';

export interface LibraryListProps {
  /** Saved songs, last opened first. */
  songs: readonly LibraryListing[];
  /** Recordings, by content hash, that have saved stems. */
  stemHashes: ReadonlySet<string>;
  /** Reopens a song; false when it could not be opened, so focus goes back to its row. */
  onOpen: (entry: LibraryEntry) => Promise<boolean>;
  /** Removes a song with an undo window (R2), from its row menu. */
  onRemove?: (entry: LibraryEntry) => void | Promise<void>;
  /** Renames a song (R1), from its row menu; false when it could not be saved. */
  onRename?: (tabHash: string, title: string) => Promise<boolean>;
  /** Whether each song's stored files were there when the list loaded (KTD7, R8), by tab hash; a song not listed shows no badge. */
  fileChecks?: ReadonlyMap<string, FileCheck>;
  /** Content hashes of stored copies found damaged when opened this session (KTD7, R9). */
  damaged?: ReadonlySet<string>;
}

interface Props extends LibraryListProps {
  /**
   * True while the rows can't open a song: on the start screen, while a file opens; in the Songs menu, under the recording
   * lock. Each row's menu stays available (KTD8).
   */
  disabled: boolean;
  /** Now, in milliseconds since the epoch, for the last-opened times. */
  now: number;
  /** The open song's tab hash; its row is marked and picking it does nothing (R3). */
  currentTabHash?: string;
  /** True while a recording with video is captured, which keeps the open song from being removed (R5). */
  recordLocked?: boolean;
  /** Shown as text above the rows, such as why they are disabled or what switching will cancel (R4). */
  notice?: string | null;
  /** Shown when there are no saved songs; without it the list renders nothing then. */
  emptyText?: string;
  /** Renders nothing but keeps the rows' state, such as which song is opening, for when they are shown again. */
  hidden?: boolean;
}

/** What the Songs menu says while stems are being separated; picking a song cancels the separation (R4). */
export const SEPARATION_WARNING = 'Switching will cancel stem separation';

/** The row menu's hint for a song whose stored tab, or a damaged recording, can be brought back (R8, KTD8). */
export const REPAIR_HINT = 'Load the original file again to repair it';

/** The most undo notices shown at once; older ones keep their timers (KTD8). */
export const MAX_NOTICES = 3;

/** The start screen's message when the library file couldn't be read and the shell set it aside (R10, KTD5). */
export const SET_ASIDE_TEXT =
  "Your song list couldn't be read, so it was set aside (as a library.json.bad file) in the app's data folder. New songs are saved to a new list.";

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

export type SongBadge = 'Tab missing' | 'Tab damaged' | 'Recording missing' | 'Recording damaged';

/**
 * A song's file problems: missing from the list-load check (R8), damaged from the session's failed opens (R9). A file
 * that is missing now is missing, even if it was found damaged earlier.
 */
export function songBadges(entry: Pick<LibraryEntry, 'tabHash' | 'recording'>, check: FileCheck | undefined, damaged: ReadonlySet<string>): SongBadge[] {
  const badges: SongBadge[] = [];
  if (check?.tab === 'missing') badges.push('Tab missing');
  else if (damaged.has(entry.tabHash)) badges.push('Tab damaged');
  if (entry.recording) {
    if (check?.recording === 'missing') badges.push('Recording missing');
    else if (damaged.has(entry.recording.hash)) badges.push('Recording damaged');
  }
  return badges;
}

export interface RowAvailability {
  /** The row button opens the song. */
  open: boolean;
  rename: boolean;
  remove: boolean;
  /** The row menu shows `REPAIR_HINT`. */
  hint: boolean;
}

/**
 * What a row offers (KTD8's table). The row opens unless the list is disabled or the song's stored tab is missing or
 * damaged; such a row's menu offers only Remove. Rename and Remove stay while the rows are disabled, except that the open
 * song can't be removed during a recording with video (R5).
 */
export function rowAvailability(state: { disabled: boolean; current: boolean; recordLocked: boolean; badges: readonly SongBadge[] }): RowAvailability {
  const tabGone = state.badges.includes('Tab missing') || state.badges.includes('Tab damaged');
  return {
    open: !state.disabled && !tabGone,
    rename: !tabGone,
    remove: !(state.current && state.recordLocked),
    hint: tabGone || state.badges.includes('Recording damaged'),
  };
}

/** Where focus goes once a row is removed: the next row, else the previous one; null for the list heading (KTD8). */
export function focusAfterRemove(tabHashes: readonly string[], removed: string): string | null {
  const at = tabHashes.indexOf(removed);
  if (at < 0) return null;
  return tabHashes[at + 1] ?? tabHashes[at - 1] ?? null;
}

/** A rename in progress: the row, the name it showed when the edit started, and what is typed. */
export interface RenameEdit {
  tabHash: string;
  shown: string;
  draft: string;
}

/** How an edit ends: Enter and Escape give focus back to the row's menu button; a blur or the menu closing leave it be. */
export type RenameEnd = 'enter' | 'escape' | 'blur' | 'close';

export interface RenameEdits {
  readonly current: RenameEdit | null;
  /** Opens an edit of this row, saving any other edit first. */
  start(tabHash: string, shown: string): void;
  /** What is typed, cut to `TITLE_MAX`. */
  change(draft: string): void;
  /** Ends the edit, if one is open: Escape drops it, anything else saves it. Only the first end of an edit does anything. */
  finish(how: RenameEnd): void;
}

/**
 * The rename edit of the song lists (R1, KTD8), apart from React so each way out can be checked: Enter, blur and the
 * Songs menu closing save, Escape cancels, an unchanged name saves nothing, and an edit ends only once, so the blur that
 * follows an Enter or a close saves nothing more.
 */
export function createRenameEdits(handlers: {
  save: (tabHash: string, title: string) => void;
  refocus: (tabHash: string) => void;
  changed: (edit: RenameEdit | null) => void;
}): RenameEdits {
  let current: RenameEdit | null = null;
  function finish(how: RenameEnd) {
    const edit = current;
    if (!edit) return;
    current = null;
    handlers.changed(null);
    if (how !== 'escape') {
      const title = cleanTitle(edit.draft);
      if (title !== edit.shown) handlers.save(edit.tabHash, title);
    }
    if (how === 'enter' || how === 'escape') handlers.refocus(edit.tabHash);
  }
  return {
    get current() {
      return current;
    },
    start(tabHash, shown) {
      finish('close');
      current = { tabHash, shown, draft: shown };
      handlers.changed(current);
    },
    change(draft) {
      if (!current) return;
      current = { ...current, draft: draft.slice(0, TITLE_MAX) };
      handlers.changed(current);
    },
    finish,
  };
}

/**
 * The rename input's keys: Enter saves; Escape cancels and goes no further, so no `Menu` sees it and the Songs menu stays
 * open (KTD8).
 */
export function renameKeyDown(e: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>, edits: Pick<RenameEdits, 'finish'>) {
  if (e.key === 'Enter') {
    e.preventDefault();
    edits.finish('enter');
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    edits.finish('escape');
  }
}

interface RenameInputProps {
  edit: RenameEdit;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBlur: (e: FocusEvent<HTMLInputElement>) => void;
}

/** The inline rename field that takes the row button's place while a song is renamed. */
export function RenameInput({ edit, onChange, onKeyDown, onBlur }: RenameInputProps) {
  return (
    <input
      type="text"
      className="library-rename"
      value={edit.draft}
      maxLength={TITLE_MAX}
      aria-label={`Rename ${edit.shown}`}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}

const NO_HASHES: ReadonlySet<string> = new Set();

/**
 * The saved songs, on the start screen and in the player's Songs menu. Renders nothing when there are none unless given
 * `emptyText`, so the first run looks as it always has. Each row has a menu beside it with Rename and Remove (KTD8).
 */
export function LibraryList({
  songs,
  stemHashes,
  onOpen,
  onRemove,
  onRename,
  fileChecks,
  damaged = NO_HASHES,
  disabled,
  now,
  currentTabHash,
  recordLocked = false,
  notice,
  emptyText,
  hidden,
}: Props) {
  const headingId = useId();
  const noticeId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [opening, setOpening] = useState<string | null>(null);
  /** The latest row opened, so an earlier open that ends late does not clear its mark. */
  const openingNow = useRef<string | null>(null);
  /**
   * The row to give focus to: one whose song could not be opened, once the rows are enabled again (`wait`), or the row
   * after a removed one, at once (`tabHash` null for the heading, after removing the last row).
   */
  const [refocus, setRefocus] = useState<{ tabHash: string | null; wait: boolean } | null>(null);
  /** The row menu button to give focus to after a rename ends with Enter or Escape. */
  const [refocusMenu, setRefocusMenu] = useState<string | null>(null);
  const [renameFailed, setRenameFailed] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [edit, setEdit] = useState<RenameEdit | null>(null);
  const latest = useRef({ onRename });
  latest.current = { onRename };
  const edits = useMemo(
    () =>
      createRenameEdits({
        save: (tabHash, title) => {
          setRenameFailed(null);
          const rename = latest.current.onRename;
          if (!rename) return;
          void rename(tabHash, title).then(
            (ok) => setRenameFailed(ok ? null : 'Could not save the new name.'),
            () => setRenameFailed('Could not save the new name.'),
          );
        },
        refocus: setRefocusMenu,
        changed: setEdit,
      }),
    [],
  );
  // An edit open when the Songs menu closes, or the list goes away, is saved then, not left to a blur (KTD8).
  useEffect(() => {
    if (!hidden) return;
    edits.finish('close');
    setRenameFailed(null);
  }, [hidden, edits]);
  useEffect(() => () => edits.finish('close'), [edits]);
  useEffect(() => {
    if (refocus === null || (refocus.wait && disabled)) return;
    setRefocus(null);
    if (refocus.tabHash === null) {
      heading.current?.focus();
      return;
    }
    const row = rows.current.get(refocus.tabHash);
    const button = row?.querySelector<HTMLButtonElement>('.library-song');
    // A row that can't open right now gives its menu button instead.
    (button && !button.disabled ? button : row?.querySelector<HTMLElement>('.row-menu > summary'))?.focus();
  }, [refocus, disabled]);
  useEffect(() => {
    if (refocusMenu === null) return;
    rows.current.get(refocusMenu)?.querySelector<HTMLElement>('.row-menu > summary')?.focus();
    setRefocusMenu(null);
  }, [refocusMenu]);
  if (hidden || (songs.length === 0 && !emptyText)) return null;

  async function open(entry: LibraryEntry) {
    if (!opensOnPick(entry.tabHash, currentTabHash) || openingNow.current === entry.tabHash) return;
    openingNow.current = entry.tabHash;
    setOpening(entry.tabHash);
    let opened = false;
    try {
      opened = await onOpen(entry);
    } finally {
      if (openingNow.current === entry.tabHash) {
        openingNow.current = null;
        setOpening(null);
        // The row was disabled while the song opened and lost focus; give it back so the player can try again or move on.
        if (!opened) setRefocus({ tabHash: entry.tabHash, wait: true });
      }
    }
  }

  function remove(entry: LibraryEntry) {
    setRefocus({ tabHash: focusAfterRemove(songs.map((song) => song.entry.tabHash), entry.tabHash), wait: false });
    void onRemove?.(entry);
  }

  return (
    <section className="library" aria-labelledby={headingId}>
      <h2 id={headingId} ref={heading} tabIndex={-1}>
        Your songs
      </h2>
      {notice && (
        <p id={noticeId} className="library-notice" role="status">
          {notice}
        </p>
      )}
      {renameFailed && (
        <p className="library-notice" role="alert">
          {renameFailed}
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
          const badges = songBadges(entry, fileChecks?.get(entry.tabHash), damaged);
          const can = rowAvailability({ disabled, current, recordLocked, badges });
          return (
            <li
              key={entry.tabHash}
              className="library-row"
              ref={(el) => {
                if (el) rows.current.set(entry.tabHash, el);
                else rows.current.delete(entry.tabHash);
              }}
            >
              {edit?.tabHash === entry.tabHash ? (
                <RenameInput
                  edit={edit}
                  onChange={(e) => edits.change(e.target.value)}
                  onKeyDown={(e) => renameKeyDown(e, edits)}
                  onBlur={() => edits.finish('blur')}
                />
              ) : (
                <button
                  type="button"
                  className="library-song"
                  disabled={!can.open}
                  aria-busy={busy || undefined}
                  aria-current={current || undefined}
                  aria-describedby={notice ? noticeId : undefined}
                  onClick={() => void open(entry)}
                >
                  <span className="library-title">{title}</span>
                  {showFileName && <span className="library-file">{entry.fileName}</span>}
                  <span className="library-meta">
                    <span>{current ? 'Playing now' : busy ? 'Opening…' : lastOpenedText(entry.openedAt, now)}</span>
                    {badges.map((badge) => (
                      <span key={badge} className="library-badge">
                        {badge}
                      </span>
                    ))}
                    {backing && <span className="library-backing">{backing}</span>}
                  </span>
                </button>
              )}
              <Menu
                label="⋯"
                ariaLabel={`Actions for ${title}`}
                className="row-menu"
                keepParentOpen
                onOpen={() => rows.current.get(entry.tabHash)?.querySelector('.row-menu > .menu-panel')?.scrollIntoView({ block: 'nearest' })}
              >
                {can.rename && (
                  <button type="button" onClick={() => edits.start(entry.tabHash, title)}>
                    Rename
                  </button>
                )}
                <button type="button" disabled={!can.remove} onClick={() => remove(entry)}>
                  Remove
                </button>
                {can.hint && <p className="library-hint">{REPAIR_HINT}</p>}
              </Menu>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}

/** Holds a notice's timer while it is hovered or focused, and lets it run on once neither is true (KTD8). */
export function createNoticeHold(pause: () => void, resume: () => void) {
  let hovered = false;
  let focused = false;
  function set(nextHovered: boolean, nextFocused: boolean) {
    const was = hovered || focused;
    hovered = nextHovered;
    focused = nextFocused;
    const now = hovered || focused;
    if (!was && now) pause();
    if (was && !now) resume();
  }
  return {
    enter: () => set(true, focused),
    leave: () => set(false, focused),
    focus: () => set(hovered, true),
    blur: () => set(hovered, false),
    /** The notice is going: a held timer runs on. */
    release: () => set(false, false),
  };
}

interface UndoNoticesProps {
  /** Pending removals, newest first. */
  items: readonly PendingRemoval[];
  onUndo: (tabHash: string) => void;
  onPause: (tabHash: string) => void;
  onResume: (tabHash: string) => void;
}

function UndoNotice({ item, onUndo, onPause, onResume }: Omit<UndoNoticesProps, 'items'> & { item: PendingRemoval }) {
  const latest = useRef({ onPause, onResume });
  latest.current = { onPause, onResume };
  const { tabHash } = item;
  const hold = useMemo(
    () =>
      createNoticeHold(
        () => latest.current.onPause(tabHash),
        () => latest.current.onResume(tabHash),
      ),
    [tabHash],
  );
  useEffect(() => hold.release, [hold]);
  return (
    <p className="undo-notice" onMouseEnter={hold.enter} onMouseLeave={hold.leave} onFocus={hold.focus} onBlur={hold.blur}>
      <span>{`Removed ${displayTitle(item.entry)}.`}</span>
      <button type="button" onClick={() => onUndo(tabHash)}>
        Undo
      </button>
    </p>
  );
}

/**
 * The undo notices, one per pending removal (R2), in one status stack: at most `MAX_NOTICES`, newest first. The region is
 * there even when empty, so a screen reader announces the first notice.
 */
export function UndoNotices({ items, onUndo, onPause, onResume }: UndoNoticesProps) {
  return (
    <div className="undo-notices" role="status">
      {items.slice(0, MAX_NOTICES).map((item) => (
        <UndoNotice key={item.tabHash} item={item} onUndo={onUndo} onPause={onPause} onResume={onResume} />
      ))}
    </div>
  );
}

/** The start screen's dismissible message that the library file was set aside (R10). */
export function SetAsideMessage({ onDismiss }: { onDismiss: () => void }) {
  return (
    <p className="notice set-aside" role="status">
      {SET_ASIDE_TEXT}{' '}
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </p>
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
    recordLocked: lockedReason !== null,
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
