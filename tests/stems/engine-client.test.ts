import { describe, expect, it, vi } from 'vitest';
import { EngineClient, EngineUnavailable, SeparationCancelled, SeparationFailed, STEM_NAMES } from '../../src/stems/engine-client';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  });
  const client = new EngineClient({ baseUrl: 'http://127.0.0.1:5000', secret: 'sekrit', fetch: fetchFn as unknown as typeof fetch, pollMs: 0 });
  return { client, calls };
}

const file = () => new File([new Uint8Array([1, 2, 3])], 'song.mp3', { type: 'audio/mpeg' });

describe('EngineClient.separate', () => {
  it('uploads the file, reports progress in order, and resolves with the job id', async () => {
    const states = [
      { status: 'queued', progress: 0 },
      { status: 'separating', progress: 0.4 },
      { status: 'done', progress: 1 },
    ];
    const { client, calls } = setup((_url, init) => {
      if (init?.method === 'POST') return json({ job_id: 'abc123' });
      return json({ job_id: 'abc123', ...states.shift() });
    });
    const seen: number[] = [];
    const id = await client.separate(file(), { onProgress: (p) => seen.push(p) });
    expect(id).toBe('abc123');
    expect(seen).toEqual([0, 0.4, 1]);
    expect(calls[0].url).toBe('http://127.0.0.1:5000/api/jobs');
    expect(new Headers(calls[0].init?.headers).get('X-TabHighway-Secret')).toBe('sekrit');
    const form = calls[0].init?.body as FormData;
    expect((form.get('file') as File).name).toBe('song.mp3');
    expect(JSON.parse(String(form.get('stems')))).toEqual([...STEM_NAMES]);
  });

  it('covers AE2: cancelling asks the engine to cancel and rejects with SeparationCancelled', async () => {
    const controller = new AbortController();
    const { client, calls } = setup((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/api/jobs')) return json({ job_id: 'j1' });
      if (init?.method === 'POST' && url.endsWith('/cancel')) return json({ status: 'cancelled' });
      controller.abort();
      return json({ status: 'separating', progress: 0.2 });
    });
    await expect(client.separate(file(), { signal: controller.signal })).rejects.toBeInstanceOf(SeparationCancelled);
    expect(calls.some((c) => c.url.endsWith('/api/jobs/j1/cancel'))).toBe(true);
  });

  it('surfaces the engine message when the job errors', async () => {
    const { client } = setup((_url, init) => (init?.method === 'POST' ? json({ job_id: 'j2' }) : json({ status: 'error', progress: 0.1, error: 'Out of memory' })));
    await expect(client.separate(file(), {})).rejects.toThrow(new SeparationFailed('Out of memory'));
  });

  it('reports a cancelled job the engine ended itself', async () => {
    const { client } = setup((_url, init) => (init?.method === 'POST' ? json({ job_id: 'j3' }) : json({ status: 'cancelled', progress: 0 })));
    await expect(client.separate(file(), {})).rejects.toBeInstanceOf(SeparationCancelled);
  });

  it('refuses an oversized file before any upload', async () => {
    const { client, calls } = setup(() => json({}));
    const big = { name: 'big.wav', size: 401 * 1024 * 1024 } as unknown as File;
    await expect(client.separate(big, {})).rejects.toThrow(/too large/);
    expect(calls).toHaveLength(0);
  });

  it('reports an engine that rejects the secret as unavailable', async () => {
    const { client } = setup(() => json({ detail: 'nope' }, 403));
    await expect(client.separate(file(), {})).rejects.toBeInstanceOf(EngineUnavailable);
  });

  it('reports an unreachable engine as unavailable', async () => {
    const { client } = setup(() => {
      throw new TypeError('fetch failed');
    });
    await expect(client.separate(file(), {})).rejects.toBeInstanceOf(EngineUnavailable);
  });
});

describe('EngineClient other calls', () => {
  it('downloads one stem with the secret header', async () => {
    const { client, calls } = setup(() => new Response(new Uint8Array([9, 9]), { status: 200 }));
    const blob = await client.fetchStem('j1', 'guitar');
    expect(blob.size).toBe(2);
    expect(calls[0].url).toBe('http://127.0.0.1:5000/api/jobs/j1/stems/guitar.wav');
    expect(new Headers(calls[0].init?.headers).get('X-TabHighway-Secret')).toBe('sekrit');
  });

  it('knows whether a job still exists', async () => {
    const { client } = setup((url) => (url.endsWith('/gone') ? json({ detail: 'job not found' }, 404) : json({ status: 'done' })));
    await expect(client.jobExists('here')).resolves.toBe(true);
    await expect(client.jobExists('gone')).resolves.toBe(false);
  });
});
