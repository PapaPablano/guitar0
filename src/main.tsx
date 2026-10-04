import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { dumpTimeline, loadScoreFromBytes, type SpikeBeat } from './model/spike';

function App() {
  const [beats, setBeats] = useState<SpikeBeat[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setBeats(dumpTimeline(loadScoreFromBytes(bytes)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>Tab Highway</h1>
      <p>Load a Guitar Pro or MusicXML file to dump its beat timing.</p>
      <input type="file" accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.mxl" onChange={(e) => onFile(e.target.files?.[0])} />
      {error && <p role="alert">{error}</p>}
      {beats.length > 0 && <p>{beats.length} beats, last at {beats[beats.length - 1].seconds.toFixed(2)} s</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
