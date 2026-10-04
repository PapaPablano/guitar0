import { useRef, useState } from 'react';
import { songsterrSearchUrl } from './songsterr';

interface DropZoneProps {
  onFile: (file: File) => void;
  onSample: () => void;
  error: string | null;
  loading: boolean;
}

export function DropZone({ onFile, onSample, error, loading }: DropZoneProps) {
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
      </div>
      <form
        className="song-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (searchUrl) window.open(searchUrl, '_blank', 'noopener,noreferrer');
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
      {loading && <p role="status">Loading…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
