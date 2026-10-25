/** The slice of the embed's player object the app uses, so tests can pass a fake. */
export interface RawYoutubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  mute(): void;
  unMute(): void;
  getPlayerState(): number;
  loadVideoById(videoId: string): void;
  destroy(): void;
}

/** The embed's player states that the app tells apart. */
export const PLAYER_STATE = { ended: 0, playing: 1, paused: 2, buffering: 3 } as const;

/** What the app needs from an embedded video, whichever object backs it. */
export interface EmbeddedPlayer {
  play(): void;
  pause(): void;
  /** Moves to a position in the video, in seconds. */
  seek(seconds: number): void;
  /** Where the video is, in seconds. */
  time(): number;
  duration(): number;
  /** Asks for a playback rate; the player may apply a different one, which `rate` reports. */
  setRate(rate: number): void;
  /** The rate the player is actually playing at. */
  rate(): number;
  /** The rates the player can play at, lowest first. */
  availableRates(): number[];
  mute(): void;
  unmute(): void;
  playing(): boolean;
  load(videoId: string): void;
  destroy(): void;
}

/** Wraps the embed's player object in the interface the app uses. */
export function wrapPlayer(raw: RawYoutubePlayer): EmbeddedPlayer {
  return {
    play: () => raw.playVideo(),
    pause: () => raw.pauseVideo(),
    seek: (seconds) => raw.seekTo(Math.max(0, seconds), true),
    time: () => raw.getCurrentTime() || 0,
    duration: () => raw.getDuration() || 0,
    setRate: (rate) => raw.setPlaybackRate(rate),
    rate: () => raw.getPlaybackRate() || 1,
    availableRates: () => [...raw.getAvailablePlaybackRates()].sort((a, b) => a - b),
    mute: () => raw.mute(),
    unmute: () => raw.unMute(),
    playing: () => raw.getPlayerState() === PLAYER_STATE.playing,
    load: (videoId) => raw.loadVideoById(videoId),
    destroy: () => raw.destroy(),
  };
}

/** The plain sentence for an error code the embed reports. */
export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'That is not a video YouTube can play. Check the link.';
    case 5:
      return 'The video could not be played in this player. Try again, or choose another video.';
    case 100:
      return 'That video was removed or is private.';
    case 101:
    case 150:
      return 'The owner of that video does not allow it to be played outside YouTube. Choose another video.';
    case 153:
      return 'YouTube would not play the video here. Check that you are online, or choose another video.';
    default:
      return 'The video could not be played.';
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api';

/** The embed's script object once it has loaded: its player constructor. */
export interface YoutubeApi {
  Player: new (host: HTMLElement, options: YoutubePlayerOptions) => RawYoutubePlayer;
}

export interface YoutubePlayerOptions {
  videoId: string;
  playerVars: Record<string, number | string>;
  events: {
    onReady: () => void;
    onError: (event: { data: number }) => void;
    onStateChange: (event: { data: number }) => void;
  };
}

/** Where the loader finds the embed's script object, and how it adds the script to the page. */
export interface ApiLoaderHost {
  YT?: YoutubeApi;
  onYouTubeIframeAPIReady?: () => void;
}

/** How long the embed's script or player may take before the player is told YouTube could not be reached. */
const LOAD_TIMEOUT_MS = 15000;
const UNREACHABLE = 'YouTube could not be reached. Check that you are online, or try again.';

/**
 * Loads the embed's script once, however many players ask for it. `addScript` puts the script on the page and calls
 * `onError` if it cannot load; the returned function resolves with the API object when the script says it is ready, and
 * rejects (so a later call tries again) when the script fails or takes too long.
 */
export function createApiLoader(
  host: ApiLoaderHost,
  addScript: (src: string, onError: () => void) => void,
  timeoutMs = LOAD_TIMEOUT_MS,
): () => Promise<YoutubeApi> {
  let pending: Promise<YoutubeApi> | null = null;
  return () => {
    if (host.YT?.Player) return Promise.resolve(host.YT);
    if (!pending) {
      pending = new Promise<YoutubeApi>((resolve, reject) => {
        const fail = () => {
          clearTimeout(timer);
          pending = null;
          reject(new Error(UNREACHABLE));
        };
        const timer = setTimeout(fail, timeoutMs);
        const previous = host.onYouTubeIframeAPIReady;
        host.onYouTubeIframeAPIReady = () => {
          clearTimeout(timer);
          previous?.();
          resolve(host.YT as YoutubeApi);
        };
        addScript(API_SRC, fail);
      });
    }
    return pending;
  };
}

const loadApi = createApiLoader(globalThis as unknown as ApiLoaderHost, (src, onError) => {
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  script.onerror = onError;
  document.head.appendChild(script);
});

export interface MountHandlers {
  /** The player reported a problem; the message is ready to show. */
  onError: (message: string) => void;
}

/** Puts a player for `videoId` into `host` and resolves once it is ready. */
export async function mountPlayer(host: HTMLElement, videoId: string, handlers: MountHandlers): Promise<EmbeddedPlayer> {
  const api = await loadApi();
  return new Promise<EmbeddedPlayer>((resolve, reject) => {
    let raw: RawYoutubePlayer | null = null;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(UNREACHABLE));
    }, LOAD_TIMEOUT_MS);
    raw = new api.Player(host, {
      videoId,
      playerVars: { playsinline: 1, rel: 0, enablejsapi: 1, origin: typeof location === 'undefined' ? '' : location.origin },
      events: {
        onReady: () => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          resolve(wrapPlayer(raw as RawYoutubePlayer));
        },
        onError: (event) => {
          const message = youtubeErrorMessage(event.data);
          if (!settled) {
            clearTimeout(timer);
            settled = true;
            reject(new Error(message));
          } else handlers.onError(message);
        },
        onStateChange: () => undefined,
      },
    });
  });
}
