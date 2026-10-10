import { MAX_AUDIO_BYTES } from '../audio/user-audio';

export const STEM_NAMES = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;
export type StemName = (typeof STEM_NAMES)[number];

export class EngineUnavailable extends Error {
  constructor(detail = 'The stem engine could not be reached.') {
    super(detail);
  }
}

export class SeparationFailed extends Error {}

export class SeparationCancelled extends Error {
  constructor() {
    super('Separation cancelled');
  }
}

export interface EngineClientOptions {
  baseUrl: string;
  secret: string;
  fetch?: typeof fetch;
  /** Milliseconds between job state reads. */
  pollMs?: number;
}

export interface SeparateOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

interface JobState {
  status: string;
  progress?: number;
  error?: string | null;
  title?: string | null;
}

/** One YouTube search result, as the engine reports it. */
export interface SearchItem {
  readonly url: string;
  readonly title: string;
  readonly duration: number | null;
  readonly uploader: string | null;
  /** Over the engine's length limit, so it cannot be imported. */
  readonly too_long: boolean;
}

const MIN_QUERY_LENGTH = 2;
/** The most results the engine returns for one search. Ranking by length needs a wide field to find a close match. */
const SEARCH_LIMIT = 15;

const SECRET_HEADER = 'X-TabHighway-Secret';

/** Talks to the bundled StemDeck engine through Tab Highway's wrapper. */
export class EngineClient {
  private readonly fetchFn: typeof fetch;
  private readonly pollMs: number;

  constructor(private readonly options: EngineClientOptions) {
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
    this.pollMs = options.pollMs ?? 500;
  }

  /** Uploads the recording, follows the job until it ends, and resolves with the job id. */
  async separate(file: File, { onProgress, signal }: SeparateOptions): Promise<string> {
    if (file.size > MAX_AUDIO_BYTES) throw new Error('That recording is too large (the limit is 400 MB).');
    const form = new FormData();
    form.append('file', file);
    form.append('stems', JSON.stringify(STEM_NAMES));
    const created = await this.request('/api/jobs', { method: 'POST', body: form, signal });
    const { job_id: jobId } = (await created.json()) as { job_id: string };
    await this.follow(jobId, onProgress, signal);
    return jobId;
  }

  /** Searches YouTube through the engine. A query shorter than two characters finds nothing. */
  async search(query: string): Promise<SearchItem[]> {
    const text = query.trim();
    if (text.length < MIN_QUERY_LENGTH) return [];
    const response = await this.request('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text, source: 'youtube', kind: 'track', limit: SEARCH_LIMIT }),
    });
    return ((await response.json()) as { items: SearchItem[] }).items;
  }

  /** Has the engine download a link's audio and separate it; resolves with the job id and the title. */
  async separateUrl(url: string, { onProgress, signal }: SeparateOptions): Promise<{ jobId: string; title: string }> {
    const created = await this.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, stems: STEM_NAMES }),
      signal,
    });
    const { job_id: jobId } = (await created.json()) as { job_id: string };
    const state = await this.follow(jobId, onProgress, signal);
    return { jobId, title: state.title || 'Imported audio' };
  }

  /** Follows a job until it is done; cancels it if `signal` aborts. */
  private async follow(jobId: string, onProgress: SeparateOptions['onProgress'], signal: AbortSignal | undefined): Promise<JobState> {
    for (;;) {
      if (signal?.aborted) {
        await this.cancel(jobId);
        throw new SeparationCancelled();
      }
      const state = (await (await this.request(`/api/jobs/${jobId}`, {})).json()) as JobState;
      onProgress?.(state.progress ?? 0);
      if (state.status === 'done') return state;
      if (state.status === 'cancelled') throw new SeparationCancelled();
      if (state.status === 'error') throw new SeparationFailed(state.error || 'Separation failed.');
      if (signal?.aborted) continue;
      if (this.pollMs > 0) await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  async cancel(jobId: string): Promise<void> {
    await this.request(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
  }

  /** True when the job is there and its stems are still on disk (the engine reports a done job with missing stems as "unavailable"). */
  async jobExists(jobId: string): Promise<boolean> {
    try {
      const state = (await (await this.request(`/api/jobs/${jobId}`, {})).json()) as JobState;
      return state.status !== 'unavailable';
    } catch (e) {
      if (e instanceof JobNotFound) return false;
      throw e;
    }
  }

  async fetchStem(jobId: string, name: StemName): Promise<Blob> {
    return (await this.request(`/api/jobs/${jobId}/stems/${name}.wav`, {})).blob();
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set(SECRET_HEADER, this.options.secret);
      response = await this.fetchFn(`${this.options.baseUrl}${path}`, { ...init, headers });
    } catch {
      // an abort during the upload is the user cancelling, not an engine that cannot be reached
      if (init.signal?.aborted) throw new SeparationCancelled();
      throw new EngineUnavailable();
    }
    if (response.status === 404) throw new JobNotFound();
    if (response.status === 401 || response.status === 403) throw new EngineUnavailable('The stem engine refused the request.');
    if (!response.ok) throw new SeparationFailed(await describe(response));
    return response;
  }
}

class JobNotFound extends Error {
  constructor() {
    super('That item is no longer available on the engine. Separate it again.');
  }
}

async function describe(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
  } catch {
    // fall through to the status line
  }
  return `The stem engine answered ${response.status}.`;
}
