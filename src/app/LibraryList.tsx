import { useEffect, useRef, useState } from 'react';
import type { LibraryEntry, LibraryListing } from './library';

export interface LibraryListProps {
  /** Saved songs, last opened first. */
  songs: readonly LibraryListing[];
  /** Recordings, by content hash, that have saved stems. */
  stemHashes: ReadonlySet<string>;
  /** Reopens a song; false when it could not be opened, so focus goes back to its row. */
  onOpen: (entry: LibraryEntry) => Promise<boolean>;
}

interface Props extends LibraryListProps {
  /** True while a file or song is opening; every row waits. */
  disabled: boolean;
  /** Now, in milliseconds since the epoch, for the last-opened times. */
  now: number;
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

/** The start screen's saved songs. Renders nothing when there are none, so the first run looks as it always has. */
export function LibraryList({ songs, stemHashes, onOpen, disabled, now }: Props) {
  const [opening, setOpening] = useState<string | null>(null);
  /** The row whose song could not be opened, to take focus back once the rows are enabled again. */
  const [refocus, setRefocus] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!refocus || disabled) return;
    rows.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus, disabled]);
  if (songs.length === 0) return null;

  async function open(entry: LibraryEntry) {
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
    <section className="library" aria-labelledby="library-heading">
      <h2 id="library-heading">Your songs</h2>
      <ul className="library-list">
        {songs.map(({ entry, title, showFileName }) => {
          const busy = opening === entry.tabHash;
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
                onClick={() => void open(entry)}
              >
                <span className="library-title">{title}</span>
                {showFileName && <span className="library-file">{entry.fileName}</span>}
                <span className="library-meta">
                  <span>{busy ? 'Opening…' : lastOpenedText(entry.openedAt, now)}</span>
                  {backing && <span className="library-backing">{backing}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
