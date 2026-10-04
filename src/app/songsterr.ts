// Links out to Songsterr's own site search. Their API sends no CORS header and never returns the
// tab file, so the app makes no requests to them; it only builds a URL for the user to open.

const SEARCH_URL = 'https://www.songsterr.com/';

/** Titles that say nothing about the song, so searching for them would be noise. */
const GENERIC_TITLES = /^(untitled|unknown|new song|song|track|track \d+|tab|guitar|no title)$/i;

/** The Songsterr search page for some text, or null when there is nothing to search for. */
export function songsterrSearchUrl(query: string): string | null {
  const text = query.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return `${SEARCH_URL}?pattern=${encodeURIComponent(text)}`;
}

/** Search text for a loaded song: "artist title", or null when the file gives no usable title. */
export function searchTextForSong(title: string, artist: string): string | null {
  const cleanTitle = title.trim();
  if (!cleanTitle || GENERIC_TITLES.test(cleanTitle)) return null;
  const cleanArtist = artist.trim();
  return cleanArtist && !GENERIC_TITLES.test(cleanArtist) ? `${cleanArtist} ${cleanTitle}` : cleanTitle;
}

/** The Songsterr link for a loaded song, or null when the file has no usable title. */
export function songsterrLinkForSong(title: string, artist: string): string | null {
  const text = searchTextForSong(title, artist);
  return text ? songsterrSearchUrl(text) : null;
}
