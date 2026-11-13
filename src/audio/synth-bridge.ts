import * as alphaTab from '@coderline/alphatab';
import { secondsToTicks, ticksToSeconds } from '../model/alphatab-adapter';
import { concatPcm, deinterleave, fitPcm, type PcmAudio } from '../export/audio';
import { AUDIO_SAMPLE_RATE } from '../export/presets';
import type { TempoPoint } from '../model/score';
import { readOutputLatency } from './output-latency';
import { loadSoundFontBytes, type SoundFontEnv } from './soundfont-cache';
import { programGain } from './track-balance';
import { mutedLevelProgram, type MutedPresets } from './guitar-tone';
import { buildSynthScore, deriveCompanionSounds, type Companion } from './synth-score';
import { DEFAULT_EFFECTS, installLiveEffects, renderWithEffects } from './synth-effects';
import { clamp, clampRate, normalizeLoop, type Clock, type LoopRange } from './clock';

/** What a track played before a tone was chosen for it: its program and every instrument change written into its beats. */
interface WrittenSound {
  program: number;
  automations: { automation: alphaTab.model.Automation; value: number }[];
}

export interface ExportAudioOptions {
  /** Apply the light effects. Defaults to the effects switch, so the export sounds like live playback (R14); the alignment passes false for the plain sound. */
  effects?: boolean;
  /** Keep every track, including the one Play along silences. The alignment compares the recording with the whole band. */
  fullBand?: boolean;
  /** Render this track alone, whatever Play along silences. An index outside the score renders the whole band. Wins over `fullBand`. */
  onlyTrack?: number;
}

/** How long a rebuild of the synth's audio may take before it is given up on. */
const RELOAD_TIMEOUT_MS = 20_000;

/**
 * One sound bank for the synth: a URL (relative URLs resolve against the page), downloaded once and kept in the browser's
 * cache, or bytes already in hand, such as a bank the player chose.
 */
export type BankSource = { url: string } | { bytes: Uint8Array };

export interface SynthOptions {
  /** The banks in layering order: the first replaces whatever the synth had, each later one is added over it. Not empty. */
  banks: readonly BankSource[];
  /** Cached bank URLs to keep when a download is stored; every other cached entry is an older build's. Defaults to the URL banks. */
  keep?: readonly string[];
  /** Called with 0..1 while the banks download, weighted by their sizes. */
  onProgress?: (fraction: number) => void;
  /** Whether the synth's effects start switched on. Defaults to on. */
  effects?: boolean;
  /** The palm-mute preset the active banks have for each tone; a tone without one plays the shared muted sound. Defaults to none. */
  mutedPresets?: MutedPresets;
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
  private readonly latency: () => number;
  private silentTrack: number | null = null;
  /** Tracks whose level has been set away from the default, so one that goes back to 1 is set back. */
  private readonly levelled = new Set<number>();
  private reloading = false;
  private reloadAgain = false;
  /** Where playback goes back to, and whether it plays again, once the rebuilt audio is ready. Seeking, playing and pausing during a rebuild change these. */
  private resumeAfterReload = false;
  private pendingSeconds = 0;
  private stopListening: (() => void) | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** The score the session hands alphaTab once its banks are in. Until then alphaTab has no score, so track changes go to this one. */
  private scoreToLoad: alphaTab.model.Score | null = null;
  private effectsSwitch = true;
  private liveEffects: (on: boolean) => void = () => {};
  /** The palm-mute parts in the synth score, each played alongside its parent track (KTD4). */
  private companions: readonly Companion[] = [];
  private mutedPresets: MutedPresets = {};

  constructor(
    private readonly api: alphaTab.AlphaTabApi,
    private readonly duration: number,
    private readonly tempoMap: readonly TempoPoint[],
    latencySeconds: number | (() => number) = readOutputLatency,
  ) {
    this.latency = typeof latencySeconds === 'function' ? latencySeconds : () => latencySeconds;
    api.playerPositionChanged.on((e) => {
      // The tick position does not depend on playback speed, so it is converted with our own tempo
      // map; the reported time does (it runs in real time when the tempo is slowed).
      this.reported = { seconds: ticksToSeconds(this.tempoMap, e.currentTick), at: performance.now() / 1000 };
    });
    // alphaTab drops a channel mute that arrives before its synth exists, so the silence is applied again once it is ready and at every play.
    api.playerReady?.on(() => this.applySilence());
    api.playerReady?.on(() => this.applyBalance());
    api.playerStateChanged.on((e) => {
      this.isPlaying = e.state === alphaTab.synth.PlayerState.Playing;
      if (this.isPlaying) this.applySilence();
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

  /** Track changes made before alphaTab has the score are applied to this one, and reach the synth when it is handed over. */
  awaitScore(score: alphaTab.model.Score): void {
    this.scoreToLoad = score;
  }

  private tracks(): alphaTab.model.Track[] {
    return (this.api.score ?? this.scoreToLoad)?.tracks ?? [];
  }

  /**
   * Tells the clock which tracks of the synth score are palm-mute parts and whose. Everything set by track index (the tone,
   * the silenced track, the export's single track) reaches a part's companions through its parent.
   */
  useCompanions(companions: readonly Companion[], mutedPresets: MutedPresets = {}): void {
    this.companions = companions;
    this.mutedPresets = mutedPresets;
  }

  private isCompanion(index: number): boolean {
    return this.companions.some((c) => c.index === index);
  }

  /** A real track's index followed by its companions' indices. */
  private withCompanions(index: number): number[] {
    return [index, ...this.companions.filter((c) => c.parent === index).map((c) => c.index)];
  }

  /** A real track and its companions; empty for an index the song does not have, or for a companion's own. */
  private group(index: number | null): alphaTab.model.Track[] {
    if (index === null || this.isCompanion(index)) return [];
    const tracks = this.tracks();
    if (!tracks[index]) return [];
    return this.withCompanions(index).flatMap((i) => (tracks[i] ? [tracks[i]] : []));
  }

  /** The program a track's level is evened out with: a companion's comes from its muted sound, not its parent's. */
  private levelProgram(tracks: readonly alphaTab.model.Track[], index: number): number {
    const companion = this.companions.find((c) => c.index === index);
    const parent = companion ? tracks[companion.parent] : undefined;
    return parent ? mutedLevelProgram(parent.playbackInfo.program) : tracks[index].playbackInfo.program;
  }

  /** The synth position interpolated to now, before the output latency is taken off. */
  private position(): number {
    const elapsed = this.isPlaying ? performance.now() / 1000 - this.reported.at : 0;
    return this.reported.seconds + elapsed * this.currentRate;
  }

  time(): number {
    const heard = this.position() - (this.isPlaying ? this.latency() * this.currentRate : 0);
    return clamp(heard, 0, this.duration);
  }

  play(): void {
    if (this.reloading) {
      this.resumeAfterReload = true;
      return;
    }
    this.api.play();
  }

  pause(): void {
    if (this.reloading) {
      this.resumeAfterReload = false;
      return;
    }
    this.api.pause();
  }

  seek(seconds: number): void {
    const clamped = clamp(seconds, 0, this.duration);
    if (this.reloading) {
      this.pendingSeconds = clamped;
      this.reported = { seconds: clamped, at: performance.now() / 1000 };
      return;
    }
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

  /** Sets each guitar track to the common level for its sound. alphaTab drops a level set before its synth exists, so this runs on every ready. */
  private applyBalance(): void {
    const tracks = this.tracks();
    tracks.forEach((track, index) => {
      const gain = programGain(this.levelProgram(tracks, index));
      if (gain === 1 && !this.levelled.has(index)) return;
      this.levelled.add(index);
      this.api.changeTrackVolume?.([track], gain);
    });
  }

  private applySilence(): void {
    const group = this.group(this.silentTrack);
    if (group.length > 0) this.api.changeTrackMute(group, true);
  }

  /**
   * Silences one track, or none, so the rest of the band plays without it; its palm-mute part goes silent with it. The export
   * follows, unless it asks for the full band.
   */
  setSilentTrack(index: number | null): void {
    if (index === this.silentTrack) return;
    const previous = this.group(this.silentTrack);
    const next = this.group(index);
    if (index !== null && next.length === 0) return;
    if (previous.length > 0) this.api.changeTrackMute(previous, false);
    if (next.length > 0) this.api.changeTrackMute(next, true);
    this.silentTrack = index;
  }

  /**
   * Plays the given tracks with the given General MIDI programs (track index -> program), and every other track with the
   * sound the tab wrote. The change reaches the live synth and the export alike, because both build their audio from the score.
   * A palm-mute part is never given a sound here: it follows its parent's new sound with the matching muted one (KTD5).
   */
  setTrackPrograms(overrides: ReadonlyMap<number, number>): void {
    const tracks = this.tracks();
    let changed = false;
    tracks.forEach((track, index) => {
      if (this.isCompanion(index)) return;
      const wanted = overrides.get(index);
      if (wanted === undefined) {
        // A track nobody chose a tone for goes back to what the tab wrote, whichever clock changed it.
        const written = writtenSounds.get(track);
        if (!written || playsAsWritten(track, written)) return;
        applyProgram(track, written, null);
        changed = true;
        return;
      }
      const written = soundAsWritten(track);
      if (track.playbackInfo.program === wanted && written.automations.every((a) => a.automation.value === wanted)) return;
      applyProgram(track, written, wanted);
      changed = true;
    });
    if (!changed) return;
    deriveCompanionSounds(tracks, this.companions, this.mutedPresets);
    this.reloadMidi();
  }

  /**
   * Rebuilds the synth's audio from the score, then puts playback back where it was: the same position, loop, speed,
   * and playing or paused. Changes that arrive while one rebuild is under way are folded into one more, and a rebuild
   * that never finishes is given up on so later changes still get through.
   */
  private reloadMidi(): void {
    // Before alphaTab has the score there is nothing to rebuild: the audio it builds when the score arrives has the change.
    if (this.disposed || !this.api.score) return;
    if (this.reloading) {
      this.reloadAgain = true;
      return;
    }
    this.reloading = true;
    // alphaTab's own tick reading lags while playing, so the position comes from this clock's interpolated one.
    this.pendingSeconds = clamp(this.position(), 0, this.duration);
    this.resumeAfterReload = this.isPlaying;
    this.startReload();
  }

  private startReload(): void {
    // alphaTab calls a ready handler at once when the synth is already ready, so only a call after the reload starts counts.
    let started = false;
    this.stopListening = this.api.playerReady.on(() => {
      if (!started) return;
      this.stopWaiting();
      if (this.reloadAgain) {
        this.reloadAgain = false;
        this.startReload();
        return;
      }
      this.finishReload();
    });
    this.reloadTimer = setTimeout(() => this.abandonReload(), RELOAD_TIMEOUT_MS);
    started = true;
    try {
      this.api.loadMidiForScore();
    } catch {
      this.abandonReload();
    }
  }

  private stopWaiting(): void {
    this.stopListening?.();
    this.stopListening = null;
    if (this.reloadTimer !== null) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
  }

  private abandonReload(): void {
    this.stopWaiting();
    this.reloading = false;
    this.reloadAgain = false;
  }

  private finishReload(): void {
    this.reloading = false;
    const seconds = this.pendingSeconds;
    this.api.tickPosition = secondsToTicks(this.tempoMap, seconds);
    this.reported = { seconds, at: performance.now() / 1000 };
    this.api.playbackSpeed = this.currentRate;
    this.setLoop(this.loopRange);
    if (this.resumeAfterReload) this.api.play();
  }

  /** Whether the effects are switched on, live and for the export. */
  get effectsOn(): boolean {
    return this.effectsSwitch;
  }

  /** Switches the effects on or off: heard at once in live playback (R11), and followed by the next export (R14). */
  setEffects(on: boolean): void {
    this.effectsSwitch = on;
    this.liveEffects(on);
  }

  /** Connects the effects switch to the live effects chain. */
  bindLiveEffects(setEnabled: (on: boolean) => void): void {
    this.liveEffects = setEnabled;
  }

  /**
   * Renders the whole song's synth audio offline, at original tempo, for the video export.
   * Calls `onProgress` with 0..1 as it goes. The silenced track is left out unless `fullBand` is set, which the alignment
   * needs so it compares the recording with every part. The light effects are applied when they are switched on, unless
   * `effects` is false: the alignment needs the plain sound.
   *
   * With the effects on, the export runs on past the tab's end for the room's length (KTD9, R13), so the last notes fade
   * out and the room decays instead of stopping dead; the result says how long that tail is. With them off it is the
   * tab's length, as the alignment needs.
   */
  async exportAudio(onProgress?: (fraction: number) => void, { effects = this.effectsSwitch, fullBand = false, onlyTrack }: ExportAudioOptions = {}): Promise<PcmAudio> {
    const options = new alphaTab.synth.AudioExportOptions();
    options.sampleRate = AUDIO_SAMPLE_RATE;
    options.useSyncPoints = false;
    options.masterVolume = 1;
    options.metronomeVolume = 0;
    const tracks = this.api.score?.tracks ?? [];
    tracks.forEach((_, index) => {
      const gain = programGain(this.levelProgram(tracks, index));
      if (gain !== 1) options.trackVolume.set(index, gain);
    });
    // A track's palm-mute part is recorded with it, and left out with it.
    if (onlyTrack !== undefined && onlyTrack >= 0 && onlyTrack < tracks.length && !this.isCompanion(onlyTrack)) {
      const kept = new Set(this.withCompanions(onlyTrack));
      tracks.forEach((_, index) => {
        if (!kept.has(index)) options.trackVolume.set(index, 0);
      });
    } else if (!fullBand && this.silentTrack !== null) {
      for (const index of this.withCompanions(this.silentTrack)) options.trackVolume.set(index, 0);
    }
    const tailSeconds = effects ? DEFAULT_EFFECTS.roomSeconds : 0;
    const endTick = tailSeconds > 0 ? secondsToTicks(this.tempoMap, this.duration + tailSeconds) : 0;
    if (endTick > 0) {
      // alphaTab's exporter cuts every voice off where its range ends, which by default is the last note's end. A range
      // reaching past the end lets the last notes release naturally while nothing new plays, without touching the score
      // that live playback and the timeline use. alphaTab times ticks past the end at the last tempo, as secondsToTicks does.
      const range = new alphaTab.synth.PlaybackRange();
      range.startTick = 0;
      range.endTick = Math.ceil(endTick);
      options.playbackRange = range;
    }
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
    if (!effects) return plain;
    if (endTick <= 0) return renderWithEffects(plain);
    // The room is rendered over the tab plus its tail, so the reverb of the last notes is in the file (KTD9).
    const withEffects = await renderWithEffects(fitPcm(plain, this.duration + tailSeconds));
    return { ...withEffects, tailSeconds };
  }

  dispose(): void {
    this.disposed = true;
    this.stopWaiting();
    this.api.destroy();
  }
}

/**
 * What each track played as the tab wrote it. It is kept with the track, not the clock: a clock rebuilt for the same score
 * (after a tuning change or a retry) finds the score already changed and must still be able to put the tab's sound back.
 */
const writtenSounds = new WeakMap<alphaTab.model.Track, WrittenSound>();

function soundAsWritten(track: alphaTab.model.Track): WrittenSound {
  let written = writtenSounds.get(track);
  if (!written) {
    written = writtenSound(track);
    writtenSounds.set(track, written);
  }
  return written;
}

function playsAsWritten(track: alphaTab.model.Track, written: WrittenSound): boolean {
  return track.playbackInfo.program === written.program && written.automations.every((a) => a.automation.value === a.value);
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

export interface BankLoadOptions {
  onProgress?: (fraction: number) => void;
  /** Cached URLs to keep; defaults to the URL sources. */
  keep?: readonly string[];
  /** True once the session is closed; nothing is handed to alphaTab after that and `ready` never settles. */
  isDisposed?: () => boolean;
  env?: SoundFontEnv;
}

/**
 * Fetches every bank, then hands them to alphaTab in order (the first replacing, the rest appended) and only then the score.
 * alphaTab rebuilds its presets and reports ready again for each bank that arrives after the score's MIDI, so posting
 * them all first gives a single ready that covers every bank. Resolves on that ready; rejects when any bank fails to
 * download or load, so the caller can offer a retry.
 */
export function loadBanksThenScore(
  api: alphaTab.AlphaTabApi,
  score: alphaTab.model.Score,
  banks: readonly BankSource[],
  { onProgress, keep, isDisposed = () => false, env }: BankLoadOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (banks.length === 0) {
      reject(new Error('The sound player has no sound bank.'));
      return;
    }
    let scoreGiven = false;
    // A ready before the score is handed over cannot cover every bank, so only one after it counts.
    api.playerReady.on(() => {
      if (scoreGiven) resolve();
    });
    api.error.on((e) => reject(e instanceof Error ? e : new Error(String(e))));
    const urls = banks.flatMap((bank) => ('url' in bank ? [bank.url] : []));
    const progress = combinedProgress(urls.length, onProgress);
    let next = 0;
    // The banks are fetched here, not by alphaTab, so they can be cached, show progress and be retried.
    Promise.all(
      banks.map((bank) => {
        if (!('url' in bank)) return Promise.resolve(bank.bytes);
        const report = progress(next++);
        return loadSoundFontBytes(bank.url, report, env, keep ?? urls);
      }),
    )
      .then((all) => {
        if (isDisposed()) return;
        for (const [index, bytes] of all.entries()) {
          if (!api.loadSoundFont(bytes, index > 0)) {
            reject(new Error('The sound player could not start.'));
            return;
          }
        }
        scoreGiven = true;
        api.renderScore(score);
      })
      .catch(reject);
  });
}

/**
 * Joins the progress of several downloads into one 0..1, weighted by their sizes. A download whose size is not known yet
 * counts as the average of the known ones. Never goes back, and reaches 1 only when every download is whole.
 */
function combinedProgress(count: number, onProgress?: (fraction: number) => void) {
  const fractions = new Array<number>(count).fill(0);
  const totals = new Array<number>(count).fill(0);
  let shown = 0;
  return (index: number) => (fraction: number, totalBytes: number) => {
    fractions[index] = fraction;
    totals[index] = totalBytes;
    const known = totals.filter((total) => total > 0);
    const guess = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    let received = 0;
    let whole = 0;
    for (let i = 0; i < count; i++) {
      const size = totals[i] > 0 ? totals[i] : guess;
      whole += size;
      received += totals[i] > 0 ? fractions[i] * size : 0;
    }
    const allIn = fractions.every((f) => f >= 1);
    const combined = allIn ? 1 : Math.min(received / whole, 0.999);
    if (combined <= shown) return;
    shown = combined;
    onProgress?.(shown);
  };
}

export interface SynthSession {
  clock: SynthClock;
  /** Resolves when every bank and the score are loaded and playback can start. */
  ready: Promise<void>;
  /** What the speakers are fed, after the effects switch, for a level meter in dev tools; null when the effects are not installed. */
  output: AudioNode | null;
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

  // The synth plays a copy with palm mutes moved to parts of their own (KTD4); the timeline and tab strip keep the loaded score.
  // The copy also has the font's unplayable sounds swapped for ones it can play.
  const mutedPresets = options.mutedPresets ?? {};
  const synthScore = buildSynthScore(score, mutedPresets);
  const api = new alphaTab.AlphaTabApi(host, settings);
  const clock = new SynthClock(api, durationSeconds, tempoMap);
  let disposed = false;
  // The same effects the export applies, so the video sounds like what was practised to.
  const effectsOn = options.effects ?? true;
  const effects = installLiveEffects(api, effectsOn);
  clock.bindLiveEffects(effects.setEnabled);
  clock.setEffects(effectsOn);

  // Until the banks are in, alphaTab has no score, so tones and the silenced track chosen meanwhile go straight to it.
  clock.awaitScore(synthScore.score);
  clock.useCompanions(synthScore.companions, mutedPresets);
  const ready = loadBanksThenScore(api, synthScore.score, options.banks, {
    onProgress: options.onProgress,
    keep: options.keep,
    isDisposed: () => disposed,
  });

  const originalDispose = clock.dispose.bind(clock);
  clock.dispose = () => {
    disposed = true;
    effects.remove();
    originalDispose();
    host.remove();
  };
  return { clock, ready, output: effects.output };
}
