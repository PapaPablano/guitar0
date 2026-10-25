import { useRef, useState, type FormEvent } from 'react';
import { OFFSET_MAX_SECONDS, OFFSET_MIN_SECONDS } from '../audio/offset-range';
import { NUDGES, nudgeOffset, offsetDirectionLabel } from './offset-controls';
import { formatDuration, rankByLength } from './stem-controls';
import type { AudioSource } from './youtube-dock';
import { SOURCE_LABELS } from './youtube-backing';
import { canSearch, searchAvailable, searchVideos, type VideoResult } from './youtube-search';
import type { YoutubeBacking } from './use-youtube-backing';

interface VideoPanelProps {
  backing: YoutubeBacking;
  /** The tab's length, to put the likeliest video first in a search. */
  tabSeconds: number;
  /** The tab time of the first note, which Sync here pairs with the video's position. */
  firstNoteSeconds: number;
  /** The YouTube Data API key; null hides search. */
  apiKey: string | null;
}

/** Attach a YouTube video by link or search, choose Original or Synth, and line the video up with the tab. */
export function VideoPanel({ backing, tabSeconds, firstNoteSeconds, apiKey }: VideoPanelProps) {
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VideoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  /** Counts searches, so an answer to an older one never replaces the results of a newer one. */
  const searchRun = useRef(0);
  const attached = backing.videoId !== null;

  function submitLink(e: FormEvent) {
    e.preventDefault();
    const problem = backing.attachLink(link);
    setLinkError(problem);
    if (!problem) setLink('');
  }

  async function submitSearch(e: FormEvent) {
    e.preventDefault();
    const run = ++searchRun.current;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await searchVideos(query, { apiKey });
      if (run === searchRun.current) setResults(found);
    } catch (err) {
      if (run !== searchRun.current) return;
      setResults(null);
      setSearchError(err instanceof Error ? err.message : 'The search failed.');
    } finally {
      if (run === searchRun.current) setSearching(false);
    }
  }

  return (
    <div className="audio-sync video-panel" role="group" aria-label="YouTube video">
      <form className="stems-row" onSubmit={submitLink}>
        <label className="field">
          YouTube link
          <input type="text" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" aria-label="YouTube link" />
        </label>
        <button type="submit" disabled={link.trim() === ''}>
          {attached ? 'Use this video instead' : 'Use this video'}
        </button>
      </form>
      {linkError && (
        <p role="alert" className="error">
          {linkError}
        </p>
      )}
      {searchAvailable(apiKey) && (
        <form className="stems-row" onSubmit={(e) => void submitSearch(e)} role="search">
          <label className="field">
            Search YouTube
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Song and artist" aria-label="Search YouTube" />
          </label>
          <button type="submit" disabled={searching || !canSearch(query)}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
      )}
      {searchError && (
        <p role="alert" className="error">
          {searchError}
        </p>
      )}
      {results !== null && (
        <ul className="video-results" aria-label="Search results">
          {results.length === 0 && <li className="muted">Nothing found. Try the song and the artist.</li>}
          {rankByLength(results, tabSeconds).map((item) => (
            <li key={item.videoId}>
              <button
                type="button"
                onClick={() => {
                  backing.attachId(item.videoId);
                  setResults(null);
                }}
              >
                {item.title}
              </button>
              <span className="muted">{[item.channel, formatDuration(item.duration)].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
      {attached && (
        <>
          <span className="stems-row" role="group" aria-label="What you hear">
            {(Object.keys(SOURCE_LABELS) as AudioSource[]).map((choice) => (
              <button key={choice} type="button" aria-pressed={backing.source === choice} disabled={!backing.ready} onClick={() => backing.setSource(choice)}>
                {SOURCE_LABELS[choice]}
              </button>
            ))}
          </span>
          <button type="button" disabled={!backing.ready} onClick={() => backing.syncHere(firstNoteSeconds)} title="Scrub the video to the first note of the tab, then press this">
            Sync here
          </button>
          <label className="field">
            Offset {backing.offset.toFixed(2)} s ({offsetDirectionLabel(backing.offset)})
            <input
              type="range"
              min={OFFSET_MIN_SECONDS}
              max={OFFSET_MAX_SECONDS}
              step={0.01}
              value={backing.offset}
              disabled={!backing.ready}
              onChange={(e) => backing.setOffset(Number(e.target.value))}
              aria-label="Video offset in seconds"
            />
          </label>
          <span className="nudge" role="group" aria-label="Nudge offset">
            {NUDGES.map(([text, size, direction, label]) => (
              <button key={text} type="button" disabled={!backing.ready} onClick={() => backing.setOffset(nudgeOffset(backing.offset, size, direction))} aria-label={`Video ${label}`}>
                {text}
              </button>
            ))}
          </span>
          <button type="button" onClick={backing.remove}>
            Remove video
          </button>
          <p className="muted note">Scrub the video with its own controls to the first note of the tab, then press Sync here. Nudge to fine-tune. A video that speeds up or slows down against the tab will still drift.</p>
        </>
      )}
      {!attached && <p className="muted note">Paste a link to a recording of the song, or search for one, then line it up with the tab.</p>}
      {backing.rateMessage && backing.source === 'original' && (
        <p role="status" className="notice">
          {backing.rateMessage}
        </p>
      )}
      {backing.message && (
        <p role="status" className="notice">
          {backing.message}
        </p>
      )}
    </div>
  );
}
