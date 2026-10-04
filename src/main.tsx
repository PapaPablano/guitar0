import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildTimeline, loadScoreFromBytes } from './model/alphatab-adapter';
import type { Timeline } from './model/score';

function App() {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setTimeline(buildTimeline(loadScoreFromBytes(bytes)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>Tab Highway</h1>
      <p>Load a Guitar Pro or MusicXML file.</p>
      <input type="file" accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl" onChange={(e) => onFile(e.target.files?.[0])} />
      {error && <p role="alert">{error}</p>}
      {timeline && (
        <p>
          {timeline.title || 'Untitled'}: {timeline.tracks.length} track(s), {timeline.durationSeconds.toFixed(1)} s
        </p>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
