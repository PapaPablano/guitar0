export type LinkResult = { ok: true; videoId: string } | { ok: false; message: string };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const PATH_FORMS = ['embed', 'shorts', 'live', 'v'];

const BAD_LINK = 'That is not a YouTube video link. Paste a link such as https://www.youtube.com/watch?v=… or https://youtu.be/…';
const PLAYLIST_ONLY = 'That link is a playlist. Open one video in it and paste that link.';

/** Reads the video ID from a pasted YouTube link in any of its common forms, or from a bare 11-character ID. */
export function parseYoutubeLink(input: string): LinkResult {
  const text = input.trim();
  if (text === '') return { ok: false, message: BAD_LINK };
  if (VIDEO_ID.test(text)) return { ok: true, videoId: text };
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, message: BAD_LINK };
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | null = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    candidate = segments[0] ?? null;
  } else if (WATCH_HOSTS.has(host)) {
    if (segments[0] === 'watch') candidate = url.searchParams.get('v');
    else if (PATH_FORMS.includes(segments[0] ?? '')) candidate = segments[1] ?? null;
    if (candidate === null && url.searchParams.has('list') && !url.searchParams.has('v')) return { ok: false, message: PLAYLIST_ONLY };
  } else {
    return { ok: false, message: BAD_LINK };
  }
  return candidate !== null && VIDEO_ID.test(candidate) ? { ok: true, videoId: candidate } : { ok: false, message: BAD_LINK };
}
