import { useRef, useState, type ReactNode } from 'react';
import { openExternal } from './desktop';
import { LibraryList, SetAsideMessage, type LibraryListProps } from './LibraryList';
import { songsterrSearchUrl } from './songsterr';

interface DropZoneProps {
  onFile: (file: File) => void;
  onSample: () => void;
  error: string | null;
  loading: boolean;
  /** Desktop only: opens the back up and restore dialog. */
  onBackup?: () => void;
  /** Desktop only: the saved songs, listed under the actions (R7). */
  library?: LibraryListProps;
  /** What the status line says while loading, such as the song being reopened. */
  loadingText?: string;
  /** True when the loading is a saved song reopening, which leaves the rows enabled; a file opening disables them (KTD8). */
  songOpening?: boolean;
  /** Desktop only: the undo notices of removed songs, shown under the actions (KTD8). */
  undoNotices?: ReactNode;
  /** Set when the library file was set aside this session and the message is not dismissed (R10). */
  setAside?: { onDismiss: () => void } | null;
}

export function DropZone({ onFile, onSample, error, loading, onBackup, library, loadingText = 'Loading…', songOpening = false, undoNotices, setAside }: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState('');
  const searchUrl = songsterrSearchUrl(query);

  return (
    <section
      className={`dropzone${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
    >
      <h1>Tab Highway</h1>
      <p>Drop a Guitar Pro or MusicXML tab here to practice it as a scrolling highway.</p>
      <p className="hint">Supported: .gp3 .gp4 .gp5 .gp .gpx .xml .musicxml .mxl. Your file stays on this device.</p>
      <div className="actions">
        <button type="button" onClick={() => input.current?.click()} disabled={loading}>
          Browse for a file
        </button>
        <button type="button" onClick={onSample} disabled={loading}>
          Try the sample riff
        </button>
        {onBackup && (
          <button type="button" onClick={onBackup}>
            Back up and restore
          </button>
        )}
      </div>
      {undoNotices}
      {setAside && <SetAsideMessage onDismiss={setAside.onDismiss} />}
      {library && <LibraryList {...library} disabled={loading && !songOpening} now={Date.now()} />}
      <form
        className="song-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (searchUrl) void openExternal(searchUrl).catch(() => {});
        }}
      >
        <label className="field">
          Looking for a tab?
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Song or artist"
            aria-label="Search Songsterr for a song or artist"
          />
        </label>
        <button type="submit" disabled={!searchUrl}>
          Search Songsterr
        </button>
        <p className="hint">Opens Songsterr in a new tab. Download a Guitar Pro file there, then drop it here.</p>
      </form>
      <input
        ref={input}
        type="file"
        hidden
        accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
      {loading && <p role="status">{loadingText}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
