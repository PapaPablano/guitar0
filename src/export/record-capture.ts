import type { AudioSource } from '../app/youtube-dock';

/** What decides whether the "Record with video" export is offered. */
export interface RecordModeEnv {
  videoAttached: boolean;
  source: AudioSource;
  /** The browser or webview can capture a tab and record it. */
  canCapture: boolean;
}

/**
 * The recorded export shows the docked YouTube player and carries its sound, so it only makes sense while that video is
 * what plays. The offline export stays the way to get the synth or a loaded file.
 */
export function recordModeOffered(env: RecordModeEnv): boolean {
  return env.videoAttached && env.source === 'original' && env.canCapture;
}

/** Whether this browser or webview exposes tab capture and a recorder. */
export function captureAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function' && typeof MediaRecorder !== 'undefined';
}

const MIME_CANDIDATES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** The first container the recorder supports; mp4 first, because the desktop folder save accepts it. */
export function pickRecorderMime(isSupported: (type: string) => boolean): string | null {
  return MIME_CANDIDATES.find((type) => isSupported(type)) ?? null;
}

/** The best supported mp4 and the best supported webm, in that order: the containers the setup check compares for encoder loss. */
export function containerCandidates(isSupported: (type: string) => boolean): string[] {
  const mp4 = MIME_CANDIDATES.find((type) => type.startsWith('video/mp4') && isSupported(type));
  const webm = MIME_CANDIDATES.find((type) => type.startsWith('video/webm') && isSupported(type));
  return [mp4, webm].filter((type): type is string => typeof type === 'string');
}

/** The saved file's name: the song and the container the recorder produced. */
export function recordingFilename(title: string, mime: string): string {
  const base = title.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
  return `${base || 'tab'}-highway-recording.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
}

/** How far through the tab the recording is, and whether it has reached the end. */
export function recordProgress(seconds: number, totalSeconds: number): { fraction: number; done: boolean } {
  if (totalSeconds <= 0) return { fraction: 1, done: true };
  const fraction = Math.min(1, Math.max(0, seconds / totalSeconds));
  return { fraction, done: seconds >= totalSeconds - 0.1 };
}

/** The audio request: the browser's voice-call processing is built for speech and flattens music, so all three stages are asked off. */
export const CLEAN_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as const;

/**
 * From the most specific request to the plainest: some browsers throw NotSupportedError on the Chromium-only hints.
 * System audio stays on `include`, since `exclude` can leave a share with no sound at all in some shells; the share is
 * steered to this tab by preferring it, and a share that carries the whole system's sound is reported instead.
 */
export function displayRequests(): DisplayMediaStreamOptions[] {
  return [
    { video: { frameRate: 30 }, audio: { ...CLEAN_AUDIO }, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include' } as DisplayMediaStreamOptions,
    { video: true, audio: { ...CLEAN_AUDIO }, preferCurrentTab: true } as DisplayMediaStreamOptions,
    { video: true, audio: { ...CLEAN_AUDIO } },
  ];
}

/**
 * Asks the browser to share this page and its sound. The browser asks the player to pick what to share each time, so this
 * must run from a click, and it asks once: a second grant would show a second picker. Rejects with the browser's own
 * error: `NotAllowedError` means the player cancelled the picker.
 */
export async function acquireStream(getDisplayMedia: (options: DisplayMediaStreamOptions) => Promise<MediaStream>): Promise<MediaStream> {
  let lastError: unknown = null;
  for (const options of displayRequests()) {
    try {
      return await getDisplayMedia(options);
    } catch (e) {
      lastError = e;
      if (e instanceof Error && e.name === 'NotAllowedError') throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The page could not be captured.');
}

/** What the player shared: this tab, a window, or the whole screen. */
export type ShareSurface = 'browser' | 'window' | 'monitor' | 'unknown';

/** What a share actually gave, read back from its tracks. */
export interface StreamInspection {
  hasAudio: boolean;
  audioLive: boolean;
  /** What the track reports after the request asked for these off; `null` when the browser does not say. */
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  sampleRate: number | null;
  channelCount: number | null;
  surface: ShareSurface;
}

const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function inspectStream(stream: Pick<MediaStream, 'getAudioTracks' | 'getVideoTracks'>): StreamInspection {
  const audio = stream.getAudioTracks()[0];
  const settings = (audio?.getSettings() ?? {}) as Record<string, unknown>;
  const surface = ((stream.getVideoTracks()[0]?.getSettings() ?? {}) as Record<string, unknown>).displaySurface;
  return {
    hasAudio: audio !== undefined,
    audioLive: audio !== undefined && audio.readyState === 'live',
    echoCancellation: flag(settings.echoCancellation),
    noiseSuppression: flag(settings.noiseSuppression),
    autoGainControl: flag(settings.autoGainControl),
    sampleRate: count(settings.sampleRate),
    channelCount: count(settings.channelCount),
    surface: surface === 'browser' || surface === 'window' || surface === 'monitor' ? surface : 'unknown',
  };
}

export interface CaptureSession {
  /** The container the recorder is producing, such as `video/mp4`. */
  readonly mime: string;
  /** Stops recording and gives the file; call once. */
  stop(): Promise<Blob>;
  /** Stops and throws the recording away. */
  cancel(): void;
}

export interface CaptureHandlers {
  /** The player ended the share from the browser's own bar; the recording up to then is still available from `stop`. */
  onEnded: () => void;
}

/** What the setup check found works best on this machine; either field left out means the default. */
export interface RecorderChoice {
  mime?: string;
  audioBitsPerSecond?: number;
}

const DEFAULT_AUDIO_BITS = 192_000;

/** Starts the long recorder on a stream that is already shared. The check runs before this, so its test sound is never in the file. */
export function startRecorder(
  captured: MediaStream,
  handlers: CaptureHandlers,
  choice: RecorderChoice = {},
  Recorder: typeof MediaRecorder = MediaRecorder,
): CaptureSession {
  const mime = choice.mime ?? pickRecorderMime((type) => Recorder.isTypeSupported(type));
  if (!mime) throw new Error('This browser cannot record video.');
  const chunks: Blob[] = [];
  const recorder = new Recorder(captured, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: choice.audioBitsPerSecond ?? DEFAULT_AUDIO_BITS });
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const release = () => captured.getTracks().forEach((t) => t.stop());
  captured.getVideoTracks()[0]?.addEventListener('ended', handlers.onEnded);
  recorder.start(1000);
  return {
    mime: mime.split(';')[0],
    stop: () =>
      new Promise<Blob>((resolve) => {
        const finish = () => {
          release();
          resolve(new Blob(chunks, { type: mime.split(';')[0] }));
        };
        if (recorder.state === 'inactive') return finish();
        recorder.onstop = finish;
        recorder.stop();
      }),
    cancel: () => {
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
      release();
    },
  };
}

/** Shares the page and starts recording straight away, with no check. Kept for callers that do not run the setup check. */
export async function startCapture(handlers: CaptureHandlers): Promise<CaptureSession> {
  if (!pickRecorderMime((type) => MediaRecorder.isTypeSupported(type))) throw new Error('This browser cannot record video.');
  const stream = await acquireStream((options) => navigator.mediaDevices.getDisplayMedia(options));
  return startRecorder(stream, handlers);
}
