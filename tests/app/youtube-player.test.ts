import { describe, expect, it, vi } from 'vitest';
import {
  createApiLoader,
  PLAYER_STATE,
  wrapPlayer,
  youtubeErrorMessage,
  type ApiLoaderHost,
  type RawYoutubePlayer,
  type YoutubeApi,
} from '../../src/app/youtube-player';

function fakeRaw(overrides: Partial<RawYoutubePlayer> = {}): RawYoutubePlayer & { position: number } {
  const state = { position: 0, rate: 1, playerState: PLAYER_STATE.paused as number };
  const raw = {
    get position() {
      return state.position;
    },
    playVideo: () => {
      state.playerState = PLAYER_STATE.playing;
    },
    pauseVideo: () => {
      state.playerState = PLAYER_STATE.paused;
    },
    seekTo: (seconds: number) => {
      state.position = seconds;
    },
    getCurrentTime: () => state.position,
    getDuration: () => 200,
    setPlaybackRate: (rate: number) => {
      state.rate = rate;
    },
    getPlaybackRate: () => state.rate,
    getAvailablePlaybackRates: () => [1, 0.5, 2, 0.25, 0.75, 1.25, 1.5, 1.75],
    mute: () => undefined,
    unMute: () => undefined,
    getPlayerState: () => state.playerState,
    loadVideoById: () => undefined,
    destroy: () => undefined,
    ...overrides,
  };
  return raw as RawYoutubePlayer & { position: number };
}

describe('wrapPlayer', () => {
  it('reports the position the player holds after a seek', () => {
    const player = wrapPlayer(fakeRaw());
    player.seek(12.5);
    expect(player.time()).toBe(12.5);
  });

  it('never seeks below zero', () => {
    const player = wrapPlayer(fakeRaw());
    player.seek(-3);
    expect(player.time()).toBe(0);
  });

  it('reports the rates the player offers, lowest first', () => {
    const player = wrapPlayer(fakeRaw());
    expect(player.availableRates()).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });

  it('reports whether the video is playing', () => {
    const player = wrapPlayer(fakeRaw());
    expect(player.playing()).toBe(false);
    player.play();
    expect(player.playing()).toBe(true);
  });

  it('treats a position or length the player cannot report yet as zero', () => {
    const player = wrapPlayer(fakeRaw({ getCurrentTime: () => Number.NaN, getDuration: () => undefined as unknown as number }));
    expect(player.time()).toBe(0);
    expect(player.duration()).toBe(0);
  });
});

describe('youtubeErrorMessage', () => {
  it('says a removed video is removed or private', () => {
    expect(youtubeErrorMessage(100)).toMatch(/removed or is private/);
  });

  it('says an owner who blocks embedding does not allow it outside YouTube', () => {
    expect(youtubeErrorMessage(101)).toMatch(/does not allow/);
    expect(youtubeErrorMessage(150)).toMatch(/does not allow/);
  });

  it('gives a plain message for a code it does not know', () => {
    expect(youtubeErrorMessage(999)).toBe('The video could not be played.');
  });
});

describe('createApiLoader', () => {
  it('adds the embed script once when two players ask for it', async () => {
    const host: ApiLoaderHost = {};
    const added: string[] = [];
    const api = { Player: class {} } as unknown as YoutubeApi;
    const load = createApiLoader(host, (src) => {
      added.push(src);
    });
    const first = load();
    const second = load();
    host.YT = api;
    host.onYouTubeIframeAPIReady?.();
    expect(await first).toBe(api);
    expect(await second).toBe(api);
    expect(added).toHaveLength(1);
  });

  it('resolves at once when the script has already loaded', async () => {
    const api = { Player: class {} } as unknown as YoutubeApi;
    const added: string[] = [];
    const load = createApiLoader({ YT: api }, (src) => added.push(src));
    expect(await load()).toBe(api);
    expect(added).toHaveLength(0);
  });

  it('still calls a ready handler another script left on the page', async () => {
    let previousCalled = false;
    const host: ApiLoaderHost = { onYouTubeIframeAPIReady: () => (previousCalled = true) };
    const load = createApiLoader(host, () => undefined);
    const pending = load();
    host.YT = { Player: class {} } as unknown as YoutubeApi;
    host.onYouTubeIframeAPIReady?.();
    await pending;
    expect(previousCalled).toBe(true);
  });

  it('rejects when the script cannot load, and tries again on the next call', async () => {
    const host: ApiLoaderHost = {};
    const failures: (() => void)[] = [];
    const load = createApiLoader(host, (_src, onError) => failures.push(onError));
    const first = load();
    failures[0]();
    await expect(first).rejects.toThrow(/could not be reached/);
    const second = load();
    expect(failures).toHaveLength(2);
    host.YT = { Player: class {} } as unknown as YoutubeApi;
    host.onYouTubeIframeAPIReady?.();
    await expect(second).resolves.toBe(host.YT);
  });

  it('rejects when the script never says it is ready', async () => {
    vi.useFakeTimers();
    try {
      const load = createApiLoader({}, () => undefined, 1000);
      const pending = load();
      const assertion = expect(pending).rejects.toThrow(/could not be reached/);
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
