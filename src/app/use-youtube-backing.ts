import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Clock } from '../audio/clock';
import { clampOffset } from '../audio/offset-range';
import { rateNotice, YoutubeClock } from '../audio/youtube-clock';
import { takesOverFromVideo } from './youtube-backing';
import { dockRules, type AudioSource, type DockRules } from './youtube-dock';
import { parseYoutubeLink } from './youtube-link';
import type { EmbeddedPlayer } from './youtube-player';
import { syncHereOffset } from './youtube-sync';
import type { YoutubeVideoStore } from './youtube-video-store';

interface Options {
  /** The tab's fingerprint, which names the video and offsets remembered for it; null with no tab open. */
  tabKey: string | null;
  durationSeconds: number;
  tempoPercent: number;
  /** The clock that plays without the video (stems, the loaded recording, or the synth), read when a hand-over happens. */
  own: () => Clock | undefined;
  /** Changes when a loaded recording or stems replace what plays without the video; the video is muted then. */
  ownIdentity: unknown;
  store: YoutubeVideoStore;
  /**
   * Called when the player attaches, removes or moves the video, with the video and offset now in use. A tab opening with
   * the video its store remembers is not a change the player made, so it is not reported (KTD4).
   */
  onPlayerVideoChange?: (video: { videoId: string; offsetSeconds: number } | null) => void;
  /** Called when the player chooses which audio is heard, or a recording they load takes over from the video. */
  onPlayerSourceChange?: (source: AudioSource) => void;
}

export interface YoutubeBacking {
  /** The attached video, or null. */
  videoId: string | null;
  source: AudioSource;
  /** The video's clock while its audio is what is heard; null otherwise. */
  activeClock: YoutubeClock | null;
  /** Whether the video's player is ready to be controlled. */
  ready: boolean;
  /** The video's offset against the tab, in seconds. */
  offset: number;
  /** A problem or note for the Backing track section, or null. */
  message: string | null;
  /** What to tell the player when the video cannot play at the tempo chosen, or null. */
  rateMessage: string | null;
  dock: DockRules;
  /** Attaches the video named by a pasted link; returns a message when the link is not a YouTube video. */
  attachLink: (text: string) => string | null;
  attachId: (videoId: string) => void;
  remove: () => void;
  setSource: (next: AudioSource) => void;
  setOffset: (seconds: number) => void;
  /** Sets the offset so the tab's first note (at `firstNoteSeconds` of tab time) sits at the video's current position. */
  syncHere: (firstNoteSeconds: number) => void;
  onPlayer: (player: EmbeddedPlayer | null) => void;
  onError: (message: string) => void;
  /**
   * A reopened song's saved source for the tab named `tabKey` (the tab about to open, or the one open now). Nothing is
   * reported back to the library, and a recording or stems that appear afterwards do not take over from the video until
   * the player makes a choice of their own or calls `endRestore` (AE2).
   */
  restore: (tabKey: string, source: AudioSource) => void;
  /** The player loaded a recording or stems themselves, so it takes over from the video as usual again. */
  endRestore: () => void;
}

/** The attached YouTube video: its player, its clock, which audio is heard, and what is remembered for the tab. */
export function useYoutubeBacking(options: Options): YoutubeBacking {
  const [videoId, setVideoId] = useState<string | null>(null);
  const [source, setSourceState] = useState<AudioSource>('original');
  const [clock, setClock] = useState<YoutubeClock | null>(null);
  const [offset, setOffsetState] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const opts = useRef(options);
  opts.current = options;
  const clockRef = useRef<YoutubeClock | null>(null);
  const sourceRef = useRef<AudioSource>('original');
  /** The attached video, for callbacks with no dependencies. */
  const videoIdRef = useRef<string | null>(null);
  const applyVideo = useCallback((id: string | null) => {
    videoIdRef.current = id;
    setVideoId(id);
  }, []);

  /** Records which audio is heard; the ref lets callbacks with no dependencies read the latest choice. */
  const applySource = useCallback((next: AudioSource) => {
    sourceRef.current = next;
    setSourceState(next);
  }, []);

  const changeSource = useCallback((next: AudioSource) => {
    const video = clockRef.current;
    if (video && next !== sourceRef.current) {
      const other = opts.current.own();
      if (next === 'synth') {
        const position = video.time();
        const wasPlaying = video.playing;
        video.park();
        other?.seek(position);
        if (wasPlaying) other?.play();
      } else {
        const position = other?.time() ?? video.time();
        const wasPlaying = other?.playing ?? false;
        other?.pause();
        video.setRate(opts.current.tempoPercent / 100);
        video.resumeAt(position, wasPlaying);
      }
    }
    applySource(next);
  }, [applySource]);

  /** A reopened song's source, waiting for its tab to open. */
  const pendingRestore = useRef<{ tabKey: string; source: AudioSource } | null>(null);
  /** The reopened tab whose recording or stems do not take over from the video; null when nothing is being restored. */
  const restoringTab = useRef<string | null>(null);

  // A tab opens with the video last attached to it, and with the source a reopened song saved (Original otherwise).
  const { tabKey, store } = options;
  useEffect(() => {
    setMessage(null);
    const pending = pendingRestore.current;
    pendingRestore.current = null;
    if (restoringTab.current !== tabKey) restoringTab.current = null;
    applySource(pending && pending.tabKey === tabKey ? pending.source : 'original');
    applyVideo(tabKey ? store.videoFor(tabKey) : null);
  }, [tabKey, store, applySource, applyVideo]);

  // A recording or stems loaded while the video's audio plays take over, and the video is muted.
  const previousOwn = useRef(options.ownIdentity);
  useEffect(() => {
    if (previousOwn.current === options.ownIdentity) return;
    previousOwn.current = options.ownIdentity;
    const video = clockRef.current;
    const restoring = restoringTab.current !== null && restoringTab.current === opts.current.tabKey;
    if (video && takesOverFromVideo({ videoReady: true, ownLoaded: options.ownIdentity !== null, source: sourceRef.current, restoring })) {
      video.park();
      applySource('synth');
      setMessage('Your recording is playing now, so the video is muted. Choose Original to hear the video again.');
      opts.current.onPlayerSourceChange?.('synth');
    }
  }, [options.ownIdentity, applySource]);

  const onPlayer = useCallback((player: EmbeddedPlayer | null) => {
    if (!player) {
      clockRef.current?.dispose();
      clockRef.current = null;
      setClock(null);
      return;
    }
    const { durationSeconds, tempoPercent, tabKey: key, store: videos, own } = opts.current;
    const other = own();
    const position = other?.time() ?? 0;
    const wasPlaying = other?.playing ?? false;
    const next = new YoutubeClock(player, durationSeconds);
    const saved = key ? videos.offsetFor(key) : null;
    next.setOffset(saved ?? 0);
    setOffsetState(saved ?? 0);
    next.setRate(tempoPercent / 100);
    if (sourceRef.current === 'original') {
      other?.pause();
      next.seek(position);
      if (wasPlaying) next.play();
    } else {
      next.park();
    }
    clockRef.current?.dispose();
    clockRef.current = next;
    setClock(next);
  }, []);

  const onError = useCallback(
    (text: string) => {
      setMessage(text);
      // A video that cannot play hands over to the synth at the same place, with the message shown.
      if (clockRef.current && sourceRef.current === 'original') changeSource('synth');
    },
    [changeSource],
  );

  const attachId = useCallback((id: string) => {
    const { tabKey: key, store: videos, own } = opts.current;
    // Changing videos while the video plays hands the position back first, so playback carries on into the next one.
    const current = clockRef.current;
    if (current && sourceRef.current === 'original') {
      const other = own();
      const position = current.time();
      const wasPlaying = current.playing;
      other?.seek(position);
      if (wasPlaying) other?.play();
    }
    restoringTab.current = null;
    setMessage(null);
    applyVideo(id);
    if (key) {
      videos.attach(key, id);
      const { onPlayerVideoChange, onPlayerSourceChange } = opts.current;
      onPlayerVideoChange?.({ videoId: id, offsetSeconds: videos.offsetFor(key) ?? 0 });
      onPlayerSourceChange?.(sourceRef.current);
    }
  }, [applyVideo]);

  const attachLink = useCallback(
    (text: string) => {
      const parsed = parseYoutubeLink(text);
      if (!parsed.ok) return parsed.message;
      attachId(parsed.videoId);
      return null;
    },
    [attachId],
  );

  const remove = useCallback(() => {
    const video = clockRef.current;
    if (video && sourceRef.current === 'original') {
      const other = opts.current.own();
      const position = video.time();
      const wasPlaying = video.playing;
      other?.seek(position);
      if (wasPlaying) other?.play();
    }
    const { tabKey: key, store: videos } = opts.current;
    restoringTab.current = null;
    applySource('original');
    setMessage(null);
    applyVideo(null);
    if (key) {
      videos.detach(key);
      opts.current.onPlayerVideoChange?.(null);
    }
  }, [applySource, applyVideo]);

  const setOffset = useCallback((seconds: number) => {
    const value = clampOffset(seconds);
    clockRef.current?.setOffset(value);
    setOffsetState(value);
    const { tabKey: key, store: videos, onPlayerVideoChange } = opts.current;
    if (key) videos.saveOffset(key, value);
    const id = videoIdRef.current;
    if (key && id) onPlayerVideoChange?.({ videoId: id, offsetSeconds: value });
  }, []);

  /** The player's own choice of audio, which is remembered; a hand-over after a playback error is not. */
  const chooseSource = useCallback(
    (next: AudioSource) => {
      restoringTab.current = null;
      changeSource(next);
      opts.current.onPlayerSourceChange?.(next);
    },
    [changeSource],
  );

  const restore = useCallback(
    (key: string, next: AudioSource) => {
      restoringTab.current = key;
      // From the start screen the tab is not open yet, so the source is applied when it opens.
      if (opts.current.tabKey === key) changeSource(next);
      else pendingRestore.current = { tabKey: key, source: next };
    },
    [changeSource],
  );

  const endRestore = useCallback(() => {
    restoringTab.current = null;
  }, []);

  const syncHere = useCallback(
    (firstNoteSeconds: number) => {
      const video = clockRef.current;
      if (!video) return;
      const result = syncHereOffset(video.videoTime(), firstNoteSeconds);
      if (result.ok) {
        setMessage(null);
        setOffset(result.offset);
      } else {
        setMessage(result.message);
      }
    },
    [setOffset],
  );

  const rateMessage = useMemo(
    () => (clock ? rateNotice(options.tempoPercent / 100, clock.appliedRateFor(options.tempoPercent / 100)) : null),
    [clock, options.tempoPercent],
  );

  return {
    videoId,
    source,
    activeClock: clock && source === 'original' ? clock : null,
    ready: clock !== null,
    offset,
    message,
    rateMessage,
    dock: dockRules(videoId !== null, source),
    attachLink,
    attachId,
    remove,
    setSource: chooseSource,
    setOffset,
    syncHere,
    onPlayer,
    onError,
    restore,
    endRestore,
  };
}
