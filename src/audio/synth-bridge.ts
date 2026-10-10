import * as alphaTab from '@coderline/alphatab';
import { secondsToTicks, ticksToSeconds } from '../model/alphatab-adapter';
import { concatPcm, deinterleave, type PcmAudio } from '../export/audio';
import { AUDIO_SAMPLE_RATE } from '../export/presets';
import type { TempoPoint } from '../model/score';
import { loadSoundFontBytes } from './soundfont-cache';
import { installLiveEffects, renderWithEffects } from './synth-effects';
import { clamp, clampRate, normalizeLoop, type Clock, type LoopRange } from './clock';

/** What a track played before a tone was chosen for it: its program and every instrument change written into its beats. */
interface WrittenSound {
  program: number;
  automations: { automation: alphaTab.model.Automation; value: number }[];
}

export interface SynthOptions {
  /** URL of the SoundFont; relative URLs resolve against the page. It is downloaded once and kept in the browser's cache. */
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
  /** Tracks currently playing a chosen tone, with the sound the tab wrote for each so it can be put back. */
  private readonly written = new Map<number, WrittenSound>();
  private reloading = false;
  private reloadAgain = false;

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

  /** The synth position interpolated to now, before the output latency is taken off. */
  private position(): number {
    const elapsed = this.isPlaying ? performance.now() / 1000 - this.reported.at : 0;
    return this.reported.seconds + elapsed * this.currentRate;
  }

  time(): number {
    const heard = this.position() - (this.isPlaying ? this.latency * this.currentRate : 0);
    return clamp(heard, 0, this.duration);
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
    this.reported = { seconds: this.position(), at: performance.now() / 1000 };
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
   * Plays the given tracks with the given General MIDI programs (track index -> program), and every other track with the
   * sound the tab wrote. The change reaches the live synth and the export alike, because both build their audio from the score.
   */
  setTrackPrograms(overrides: ReadonlyMap<number, number>): void {
    const tracks = this.api.score?.tracks ?? [];
    let changed = false;
    for (const index of new Set([...this.written.keys(), ...overrides.keys()])) {
      const track = tracks[index];
      if (!track) continue;
      const wanted = overrides.get(index);
      const before = this.written.get(index);
      if (wanted === undefined) {
        if (!before) continue;
        applyProgram(track, before, null);
        this.written.delete(index);
        changed = true;
        continue;
      }
      const written = before ?? writtenSound(track);
      if (!before) this.written.set(index, written);
      if (track.playbackInfo.program === wanted && written.automations.every((a) => a.automation.value === wanted)) continue;
      applyProgram(track, written, wanted);
      changed = true;
    }
    if (changed) this.reloadMidi();
  }

  /**
   * Rebuilds the synth's audio from the score, then puts playback back where it was: the same position, loop, speed,
   * and playing or paused. Changes that arrive while one rebuild is under way are folded into one more.
   */
  private reloadMidi(): void {
    if (this.reloading) {
      this.reloadAgain = true;
      return;
    }
    this.reloading = true;
    // alphaTab's own tick reading lags while playing, so the position comes from this clock's interpolated one.
    const seconds = clamp(this.position(), 0, this.duration);
    const tick = secondsToTicks(this.tempoMap, seconds);
    const wasPlaying = this.isPlaying;
    // alphaTab calls a ready handler at once when the synth is already ready, so only a call after the reload starts counts.
    let started = false;
    const off = this.api.playerReady.on(() => {
      if (!started) return;
      off();
      this.reloading = false;
      this.api.tickPosition = tick;
      this.reported = { seconds, at: performance.now() / 1000 };
      this.api.playbackSpeed = this.currentRate;
      this.setLoop(this.loopRange);
      if (this.reloadAgain) {
        this.reloadAgain = false;
        this.reloadMidi();
      } else if (wasPlaying) {
        this.api.play();
      }
    });
    started = true;
    this.api.loadMidiForScore();
  }

  /**
   * Renders the whole song's synth audio offline, at original tempo, for the video export.
   * Calls `onProgress` with 0..1 as it goes. The light effects heard live are applied too, unless `effects` is false: the
   * alignment compares the tab with a recording and needs the plain sound.
   */
  async exportAudio(onProgress?: (fraction: number) => void, { effects = true } = {}): Promise<PcmAudio> {
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
    const plain = concatPcm(chunks, AUDIO_SAMPLE_RATE);
    return effects ? renderWithEffects(plain) : plain;
  }

  dispose(): void {
    this.api.destroy();
  }
}

function writtenSound(track: alphaTab.model.Track): WrittenSound {
  return { program: track.playbackInfo.program, automations: instrumentAutomations(track).map((automation) => ({ automation, value: automation.value })) };
}

/** Every instrument change written into a track's beats; the first beat carries the track's opening sound. */
function instrumentAutomations(track: alphaTab.model.Track): alphaTab.model.Automation[] {
  const found: alphaTab.model.Automation[] = [];
  for (const staff of track.staves)
    for (const bar of staff.bars)
      for (const voice of bar.voices)
        for (const beat of voice.beats)
          for (const automation of beat.automations) if (automation.type === alphaTab.model.AutomationType.Instrument) found.push(automation);
  return found;
}

/** Sets a track's program and every instrument change in it to `program`, or puts back what the tab wrote when it is null. */
function applyProgram(track: alphaTab.model.Track, written: WrittenSound, program: number | null): void {
  track.playbackInfo.program = program ?? written.program;
  for (const entry of written.automations) entry.automation.value = program ?? entry.value;
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
  settings.player.enableCursor = false;
  settings.player.enableAnimatedBeatCursor = false;
  settings.player.enableElementHighlighting = false;
  settings.player.scrollMode = alphaTab.ScrollMode.Off;
  settings.core.fontDirectory = './font/';

  const api = new alphaTab.AlphaTabApi(host, settings);
  const clock = new SynthClock(api, durationSeconds, tempoMap);
  let disposed = false;
  // The same effects the export applies, so the video sounds like what was practised to.
  const removeEffects = installLiveEffects(api);

  const ready = new Promise<void>((resolve, reject) => {
    api.playerReady.on(() => resolve());
    api.error.on((e) => reject(e instanceof Error ? e : new Error(String(e))));
    api.renderScore(score);
    // The SoundFont is fetched here, not by alphaTab, so it can be cached, show progress and be retried.
    loadSoundFontBytes(options.soundFontUrl, options.onProgress).then((bytes) => {
      if (disposed) return;
      // alphaTab hands the buffer to its worker, so it gets a copy and the cached bytes stay whole.
      if (!api.loadSoundFont(bytes.slice(), false)) reject(new Error('The sound player could not start.'));
    }, reject);
  });

  const originalDispose = clock.dispose.bind(clock);
  clock.dispose = () => {
    disposed = true;
    removeEffects();
    originalDispose();
    host.remove();
  };
  return { clock, ready };
}
