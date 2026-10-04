import { useRef, useState } from 'react';

interface DropZoneProps {
  onFile: (file: File) => void;
  onSample: () => void;
  error: string | null;
  loading: boolean;
}

export function DropZone({ onFile, onSample, error, loading }: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

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
