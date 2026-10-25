import { describe, expect, it } from 'vitest';
import { rankByLength } from '../../src/app/stem-controls';
import { configuredApiKey, parseIsoDuration, searchAvailable, searchVideos, SearchError, type VideoResult } from '../../src/app/youtube-search';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(routes: { search?: unknown; videos?: unknown; status?: number }): { fn: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (routes.status && routes.status !== 200) return jsonResponse(routes.search, routes.status);
    return jsonResponse(url.includes('/search?') ? routes.search : routes.videos);
  }) as typeof fetch;
  return { fn, urls };
}

const item = (id: string, title: string) => ({ id: { videoId: id }, snippet: { title, channelTitle: 'Band' } });

describe('searchVideos', () => {
  it('maps results to title, channel and length', async () => {
    const { fn } = fakeFetch({
      search: { items: [item('a', 'Song A'), item('b', 'Song B')] },
      videos: { items: [{ id: 'a', contentDetails: { duration: 'PT3M10S' } }, { id: 'b', contentDetails: { duration: 'PT1H1M' } }] },
    });
    const results = await searchVideos('song', { apiKey: 'K', fetch: fn });
    expect(results).toEqual([
      { videoId: 'a', title: 'Song A', channel: 'Band', duration: 190 },
      { videoId: 'b', title: 'Song B', channel: 'Band', duration: 3660 },
    ]);
  });

  it('asks only for videos that can be embedded', async () => {
    const { fn, urls } = fakeFetch({ search: { items: [item('a', 'A')] }, videos: { items: [] } });
    await searchVideos('song', { apiKey: 'K', fetch: fn });
    expect(urls[0]).toContain('videoEmbeddable=true');
  });

  it('gives a result with no length a null length and does not throw', async () => {
    const { fn } = fakeFetch({ search: { items: [item('a', 'A')] }, videos: { items: [{ id: 'a', contentDetails: { duration: 'P0D' } }] } });
    const [result] = await searchVideos('song', { apiKey: 'K', fetch: fn });
    expect(result.duration).toBeNull();
  });

  it('returns an empty list for no results without asking for lengths', async () => {
    const { fn, urls } = fakeFetch({ search: { items: [] }, videos: { items: [] } });
    expect(await searchVideos('nothing here', { apiKey: 'K', fetch: fn })).toEqual([]);
    expect(urls).toHaveLength(1);
  });

  it('makes no request without a key and says search is not set up', async () => {
    const { fn, urls } = fakeFetch({ search: {}, videos: {} });
    await expect(searchVideos('song', { apiKey: null, fetch: fn })).rejects.toThrow(/not set up/);
    expect(urls).toHaveLength(0);
  });

  it('makes no request for a query that is too short', async () => {
    const { fn, urls } = fakeFetch({ search: {}, videos: {} });
    expect(await searchVideos(' a ', { apiKey: 'K', fetch: fn })).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it('says the day is used up when the quota is exceeded', async () => {
    const { fn } = fakeFetch({ search: { error: { errors: [{ reason: 'quotaExceeded' }] } }, status: 403 });
    await expect(searchVideos('song', { apiKey: 'K', fetch: fn })).rejects.toThrow(/used up for today/);
  });

  it('gives a plain message when YouTube cannot be reached', async () => {
    const fn = (async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    const error = await searchVideos('song', { apiKey: 'K', fetch: fn }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect((error as Error).message).toMatch(/Could not reach YouTube/);
  });
});

describe('parseIsoDuration', () => {
  it('reads hours, minutes and seconds', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('PT10M')).toBe(600);
  });

  it('gives null for a missing or zero length', () => {
    expect(parseIsoDuration(undefined)).toBeNull();
    expect(parseIsoDuration('P0D')).toBeNull();
    expect(parseIsoDuration('junk')).toBeNull();
  });
});

describe('searchAvailable and configuredApiKey', () => {
  it('offers search only with a key', () => {
    expect(searchAvailable('K')).toBe(true);
    expect(searchAvailable(null)).toBe(false);
    expect(searchAvailable('')).toBe(false);
  });

  it('reads a build key and treats a blank one as none', () => {
    expect(configuredApiKey(' abc ')).toBe('abc');
    expect(configuredApiKey('')).toBeNull();
    expect(configuredApiKey(undefined)).toBeNull();
  });
});

describe('ranking video results by length', () => {
  it('orders results by closeness to the tab length, no length last', () => {
    const v = (id: string, duration: number | null): VideoResult => ({ videoId: id, title: id, channel: null, duration });
    const ranked = rankByLength([v('180', 180), v('420', 420), v('240', 240), v('none', null)], 230);
    expect(ranked.map((r) => r.videoId)).toEqual(['240', '180', '420', 'none']);
  });
});
