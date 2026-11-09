/** Set at build time by vite.config.ts from VITE_YOUTUBE_API_KEY; undefined outside a Vite build (e.g. tests). */
declare const __YOUTUBE_API_KEY__: string | undefined;

/** One search result: enough to pick the right video. */
export interface VideoResult {
  readonly videoId: string;
  readonly title: string;
  readonly channel: string | null;
  /** Length in seconds, or null when YouTube did not say. */
  readonly duration: number | null;
}

export interface SearchOptions {
  /** The YouTube Data API key; null means search is not set up in this build. */
  readonly apiKey: string | null;
  readonly fetch?: typeof fetch;
  readonly maxResults?: number;
}

const MIN_QUERY_LENGTH = 2;
/** Ranking by length needs a wide field to find a close match. */
const DEFAULT_RESULTS = 15;
const API = 'https://www.googleapis.com/youtube/v3';

/** The key this build was made with, or null when none was given. */
export function configuredApiKey(defined: unknown = typeof __YOUTUBE_API_KEY__ === 'undefined' ? undefined : __YOUTUBE_API_KEY__): string | null {
  return typeof defined === 'string' && defined.trim() !== '' ? defined.trim() : null;
}

/** Whether a query is long enough to search for. */
export function canSearch(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

/** Whether search can be offered: only with a key. Without one, pasting a link still works. */
export function searchAvailable(apiKey: string | null): boolean {
  return apiKey !== null && apiKey !== '';
}

/** Reads a video length such as PT1H2M3S into seconds; null for anything else (a live stream has none). */
export function parseIsoDuration(text: string | undefined): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text ?? '');
  if (!match) return null;
  const [, d, h, m, s] = match;
  const seconds = Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return seconds > 0 ? seconds : null;
}

/** A search that could not give results, with a sentence for the player. */
export class SearchError extends Error {}

interface SearchResponse {
  items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }[];
  error?: { errors?: { reason?: string }[] };
}

interface VideosResponse {
  items?: { id?: string; contentDetails?: { duration?: string } }[];
  error?: { errors?: { reason?: string }[] };
}

async function getJson<T extends { error?: { errors?: { reason?: string }[] } }>(fetchFn: typeof fetch, url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch {
    throw new SearchError('Could not reach YouTube. Check that you are online, or paste a link instead.');
  }
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    throw new SearchError('YouTube search gave an answer that could not be read. Paste a link instead.');
  }
  if (!response.ok) {
    const reason = body.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded') {
      throw new SearchError('YouTube search is used up for today. Paste a link instead.');
    }
    throw new SearchError('YouTube search is not working right now. Paste a link instead.');
  }
  return body;
}

/** Searches YouTube for videos that can be embedded, by text. */
export async function searchVideos(query: string, options: SearchOptions): Promise<VideoResult[]> {
  const text = query.trim();
  if (!searchAvailable(options.apiKey)) throw new SearchError('Search is not set up in this build. Paste a link instead.');
  if (text.length < MIN_QUERY_LENGTH) return [];
  const fetchFn = options.fetch ?? fetch;
  const key = encodeURIComponent(options.apiKey as string);
  const search = await getJson<SearchResponse>(
    fetchFn,
    `${API}/search?part=snippet&type=video&videoEmbeddable=true&maxResults=${options.maxResults ?? DEFAULT_RESULTS}&q=${encodeURIComponent(text)}&key=${key}`,
  );
  const found = (search.items ?? []).flatMap((item) => {
    const videoId = item.id?.videoId;
    return videoId ? [{ videoId, title: item.snippet?.title ?? 'Untitled', channel: item.snippet?.channelTitle ?? null }] : [];
  });
  if (found.length === 0) return [];
  const details = await getJson<VideosResponse>(fetchFn, `${API}/videos?part=contentDetails&id=${found.map((f) => f.videoId).join(',')}&key=${key}`);
  const lengths = new Map((details.items ?? []).map((item) => [item.id, parseIsoDuration(item.contentDetails?.duration)] as const));
  return found.map((f) => ({ ...f, duration: lengths.get(f.videoId) ?? null }));
}
