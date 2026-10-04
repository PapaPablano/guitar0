import * as alphaTab from '@coderline/alphatab';
import { secondsToTicks, ticksToSeconds } from '../model/alphatab-adapter';
import { concatPcm, deinterleave, type PcmAudio } from '../export/audio';
import { AUDIO_SAMPLE_RATE } from '../export/presets';
import type { TempoPoint } from '../model/score';
import { clamp, clampRate, normalizeLoop, type Clock, type LoopRange } from './clock';

export interface SynthOptions {
  /** URL of the SoundFont; relative URLs resolve against the page. */
  soundFontUrl: string;
  /** Called with 0..1 while the SoundFont loads. */
  onProgress?: (fraction: number) => void;
}

/** Output latency in seconds: the delay between the synth reporting a position and it being heard. */
let cachedLatency: number | undefined;

export function readOutputLatency(): number {
  if (cachedLatency !== undefined) return cachedLatency;
  try {
    const ctx = new AudioContext();
    const latency = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    void ctx.close();
    cachedLatency = latency;
    return latency;
  } catch {
    return 0;
  }
}

/**
 * A Clock backed by alphaTab's synth. The synth reports its position a few times a second; between
 * reports the position is interpolated with the monotonic clock, and the output latency is taken
 * off so the views line up with what is heard rather than with what was just rendered.
 */
export class SynthClock implements Clock {
  private reported = { seconds: 0, at: performance.now() / 1000 };
  private isPlaying = false;
  private currentRate = 1;
  private loopRange: LoopRange | null = null;
  private readonly latency: number;

  constructor(
    private readonly api: alphaTab.AlphaTabApi,
    private readonly duration: number,
    private readonly tempoMap: readonly TempoPoint[],
    latencySeconds = readOutputLatency(),
  ) {
    this.latency = latencySeconds;
    api.playerPositionChanged.on((e) => {
      // The tick position does not depend on playback speed, so it is converted with our own tempo
      // map; the reported time does (it runs in real time when the tempo is slowed).
      this.reported = { seconds: ticksToSeconds(this.tempoMap, e.currentTick), at: performance.now() / 1000 };
    });
    api.playerStateChanged.on((e) => {
      this.isPlaying = e.state === alphaTab.synth.PlayerState.Playing;
      this.reported = { seconds: this.reported.seconds, at: performance.now() / 1000 };
    });
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get rate(): number {
    return this.currentRate;
  }

  get loop(): LoopRange | null {
    return this.loopRange;
  }

  time(): number {
    let seconds = this.reported.seconds;
    if (this.isPlaying) seconds += (performance.now() / 1000 - this.reported.at) * this.currentRate;
    seconds -= this.isPlaying ? this.latency * this.currentRate : 0;
    return clamp(seconds, 0, this.duration);
  }

  play(): void {
    this.api.play();
  }

  pause(): void {
    this.api.pause();
  }

  seek(seconds: number): void {
    const clamped = clamp(seconds, 0, this.duration);
    this.api.tickPosition = secondsToTicks(this.tempoMap, clamped);
    this.reported = { seconds: clamped, at: performance.now() / 1000 };
  }

  setRate(rate: number): void {
    this.currentRate = clampRate(rate);
    this.reported = { seconds: this.time(), at: performance.now() / 1000 };
    this.api.playbackSpeed = this.currentRate;
  }

  setLoop(range: LoopRange | null): void {
    this.loopRange = normalizeLoop(range);
    if (this.loopRange && this.loopRange.startTick !== undefined && this.loopRange.endTick !== undefined) {
      const playbackRange = new alphaTab.synth.PlaybackRange();
      playbackRange.startTick = this.loopRange.startTick;
      playbackRange.endTick = this.loopRange.endTick;
      this.api.playbackRange = playbackRange;
      this.api.isLooping = true;
    } else {
      this.api.playbackRange = null;
      this.api.isLooping = false;
    }
  }

  /**
   * Renders the whole song's synth audio offline, at original tempo, for the video export.
   * Calls `onProgress` with 0..1 as it goes.
   */
  async exportAudio(onProgress?: (fraction: number) => void): Promise<PcmAudio> {
    const options = new alphaTab.synth.AudioExportOptions();
    options.sampleRate = AUDIO_SAMPLE_RATE;
    options.useSyncPoints = false;
    options.masterVolume = 1;
    options.metronomeVolume = 0;
    const exporter = await this.api.exportAudio(options);
    const chunks: { left: Float32Array; right: Float32Array }[] = [];
    try {
      for (;;) {
        const chunk = await exporter.render(1000);
        if (!chunk) break;
        chunks.push(deinterleave(chunk.samples));
        if (chunk.endTime > 0) onProgress?.(Math.min(1, chunk.currentTime / chunk.endTime));
      }
    } finally {
      exporter.destroy();
    }
    return concatPcm(chunks, AUDIO_SAMPLE_RATE);
  }

  dispose(): void {
    this.api.destroy();
  }
}

export interface SynthSession {
  clock: SynthClock;
  /** Resolves when the SoundFont and score are loaded and playback can start. */
  ready: Promise<void>;
}

/**
 * Creates a hidden alphaTab player for a score. alphaTab also lays out notation for the element it
 * is given, so the element is kept tiny and off screen; only its synth is used.
 */
export function createSynthSession(
  score: alphaTab.model.Score,
  durationSeconds: number,
  tempoMap: readonly TempoPoint[],
  options: SynthOptions,
): SynthSession {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:200px;height:100px;overflow:hidden';
  document.body.appendChild(host);

  const settings = new alphaTab.Settings();
  settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
  settings.player.soundFont = options.soundFontUrl;
  settings.player.enableCursor = false;
  settings.player.enableAnimatedBeatCursor = false;
  settings.player.enableElementHighlighting = false;
  settings.player.scrollMode = alphaTab.ScrollMode.Off;
  settings.core.fontDirectory = './font/';

  const api = new alphaTab.AlphaTabApi(host, settings);
  const clock = new SynthClock(api, durationSeconds, tempoMap);

  const ready = new Promise<void>((resolve, reject) => {
    api.soundFontLoad.on((e) => options.onProgress?.(e.total > 0 ? e.loaded / e.total : 0));
    api.playerReady.on(() => resolve());
    api.error.on((e) => reject(e instanceof Error ? e : new Error(String(e))));
    api.renderScore(score);
  });

  const originalDispose = clock.dispose.bind(clock);
  clock.dispose = () => {
    originalDispose();
    host.remove();
  };
  return { clock, ready };
}
