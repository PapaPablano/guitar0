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

/**
 * Starts capturing this page and its sound. The browser asks the player to pick what to share each time, so this must run
 * from a click. Rejects with the browser's own error: `NotAllowedError` means the player cancelled the picker.
 */
export async function startCapture(handlers: CaptureHandlers): Promise<CaptureSession> {
  const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) throw new Error('This browser cannot record video.');
  // From the most specific request to the plainest: some browsers throw NotSupportedError on the Chromium-only hints.
  const attempts: DisplayMediaStreamOptions[] = [
    { video: { frameRate: 30 }, audio: true, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include' } as DisplayMediaStreamOptions,
    { video: true, audio: true, preferCurrentTab: true } as DisplayMediaStreamOptions,
    { video: true, audio: true },
  ];
  let stream: MediaStream | null = null;
  let lastError: unknown = null;
  for (const options of attempts) {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(options);
      break;
    } catch (e) {
      lastError = e;
      if (e instanceof Error && e.name === 'NotAllowedError') throw e;
    }
  }
  if (!stream) throw lastError instanceof Error ? lastError : new Error('The page could not be captured.');
  const captured = stream;
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(captured, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
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
