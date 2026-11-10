import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { buildSynthScore } from '../../src/audio/synth-score';
import { SynthClock } from '../../src/audio/synth-bridge';
import { DEFAULT_EFFECTS } from '../../src/audio/synth-effects';
import type { PcmAudio } from '../../src/export/audio';
import { slicePcm } from '../../src/export/audio-file';
import type { StartMessage } from '../../src/export/encoder.worker';
import { startExport } from '../../src/export/exporter';
import { frameTabTime } from '../../src/export/audio';
import { AUDIO_SAMPLE_RATE, frameCount, frameTime, presetById } from '../../src/export/presets';
import { renderStageFrame, type FrameContext } from '../../src/render/stage-frame';
import { buildSoundFont } from '../fixtures/soundfonts';
import { makeTimeline } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';

/** One bar of quarter notes at 120 bpm, ending on a held half note: two seconds of tab. */
const ENDS_ON_A_LONG_NOTE = String.raw`\tempo 120 :4 3.3 5.3 :2 3.3`;

const SILENT_OUTPUT = {
  sampleRate: AUDIO_SAMPLE_RATE,
  ready: { on() {} },
  sampleRequest: { on() {} },
  samplesPlayed: { on() {} },
  open() {},
} as unknown as alphaTab.synth.ISynthOutput;

/**
 * A stand-in for alphaTab's API whose `exportAudio` does what alphaTab 1.8.4's does (generate the score's MIDI, map track
 * volumes to channels, pass the playback range on) but renders on alphaTab's real exporter in this thread, from `bank`.
 */
function realExportApi(score: alphaTab.model.Score, bank: Uint8Array) {
  const noop = { on: () => () => {} };
  const ranges: (alphaTab.synth.PlaybackRange | null | undefined)[] = [];
  const api = {
    playerPositionChanged: noop,
    playerStateChanged: noop,
    playerReady: noop,
    destroy: () => {},
    score,
    playbackRange: null,
    async exportAudio(options: alphaTab.synth.AudioExportOptions) {
      ranges.push(options.playbackRange);
      const midi = new alphaTab.midi.MidiFile();
      const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new alphaTab.midi.AlphaSynthMidiFileHandler(midi));
      generator.applyTranspositionPitches = false;
      generator.generate();
      const withChannels = new alphaTab.synth.AudioExportOptions();
      withChannels.soundFonts = [bank];
      withChannels.sampleRate = options.sampleRate;
      withChannels.masterVolume = options.masterVolume;
      withChannels.metronomeVolume = options.metronomeVolume;
      withChannels.playbackRange = options.playbackRange;
      for (const [index, volume] of options.trackVolume) {
        const track = score.tracks[index];
        withChannels.trackVolume.set(track.playbackInfo.primaryChannel, volume);
        withChannels.trackVolume.set(track.playbackInfo.secondaryChannel, volume);
      }
      const exporter = new alphaTab.synth.AlphaSynth(SILENT_OUTPUT, 100).exportAudio(withChannels, midi, [], new Map());
      return { render: async (ms: number) => exporter.render(ms) ?? null, destroy: () => {} };
    },
  };
  return { api, ranges };
}

function songEndingOnALongNote() {
  const original = loadAlphaTex(ENDS_ON_A_LONG_NOTE);
  const timeline = buildTimeline(original);
  const { score } = buildSynthScore(original);
  // A looped sample that fades over a second once released, on the program the track plays.
  const bank = buildSoundFont([{ name: 'Held', bank: 0, program: score.tracks[0].playbackInfo.program, samples: ['mono'], releaseSeconds: 1 }]);
  const { api, ranges } = realExportApi(score, bank);
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, timeline.durationSeconds, timeline.tempoMap, 0);
  return { timeline, score, api, ranges, clock };
}

function peak(pcm: PcmAudio, fromSeconds: number, toSeconds: number): number {
  let max = 0;
  const end = Math.min(pcm.left.length, Math.round(toSeconds * pcm.sampleRate));
  for (let i = Math.round(fromSeconds * pcm.sampleRate); i < end; i++) max = Math.max(max, Math.abs(pcm.left[i]), Math.abs(pcm.right[i]));
  return max;
}

const samplesFor = (seconds: number) => Math.ceil(seconds * AUDIO_SAMPLE_RATE);

describe('the full-song audio export ends with the room', () => {
  it('covers AE6: a 2-second tab exports as 2 s plus the room, and says how long the tail is', async () => {
    const { timeline, clock } = songEndingOnALongNote();
    expect(timeline.durationSeconds).toBeCloseTo(2, 6);
    const pcm = await clock.exportAudio(undefined, { effects: true });
    expect(pcm.left.length).toBe(samplesFor(2 + DEFAULT_EFFECTS.roomSeconds));
    expect(pcm.right.length).toBe(pcm.left.length);
    expect(pcm.tailSeconds).toBeCloseTo(DEFAULT_EFFECTS.roomSeconds, 9);
  });

  it('lets the last note ring past the tab end instead of dropping to silence', async () => {
    const { timeline, clock } = songEndingOnALongNote();
    const end = timeline.durationSeconds;
    const pcm = await clock.exportAudio(undefined, { effects: true });
    // Still sounding while held, and still sounding as it fades just after the tab ends.
    expect(peak(pcm, end - 0.1, end)).toBeGreaterThan(0.01);
    expect(peak(pcm, end + 0.02, end + 0.1)).toBeGreaterThan(0.01);
    // A fade, not a step: quieter later in the tail.
    expect(peak(pcm, end + 0.9, end + 1.1)).toBeLessThan(peak(pcm, end + 0.02, end + 0.1));
  });

  it('keeps the plain length with the effects off', async () => {
    const { timeline, clock, ranges } = songEndingOnALongNote();
    clock.setEffects(false);
    const pcm = await clock.exportAudio();
    expect(ranges).toEqual([undefined]);
    expect(pcm.tailSeconds).toBeUndefined();
    expect(Math.abs(pcm.left.length - samplesFor(timeline.durationSeconds))).toBeLessThan(200);
  });

  it('keeps the alignment render the tab length, for one track and for the band', async () => {
    const { timeline, clock, ranges } = songEndingOnALongNote();
    clock.setEffects(true);
    for (const options of [{ onlyTrack: 0, effects: false }, { fullBand: true, effects: false }]) {
      const pcm = await clock.exportAudio(undefined, options);
      expect(pcm.tailSeconds).toBeUndefined();
      expect(Math.abs(pcm.left.length - samplesFor(timeline.durationSeconds))).toBeLessThan(200);
    }
    expect(ranges).toEqual([undefined, undefined]);
  });

  it('leaves the score the live player and timeline use untouched', async () => {
    const { timeline, score, api, clock } = songEndingOnALongNote();
    const bars = score.masterBars.length;
    const midiBefore = buildTimeline(score).durationSeconds;
    await clock.exportAudio(undefined, { effects: true });
    expect(score.masterBars.length).toBe(bars);
    expect(api.playbackRange).toBeNull();
    expect(buildTimeline(score).durationSeconds).toBe(midiBefore);
    expect(timeline.durationSeconds).toBeCloseTo(2, 6);
  });
});

describe('a loop-range export', () => {
  it('still has exactly the loop length, with no tail', async () => {
    const { clock } = songEndingOnALongNote();
    const full = await clock.exportAudio(undefined, { effects: true });
    const loop = slicePcm(full, 1, 1);
    expect(loop.left.length).toBe(samplesFor(1));
    expect(loop.tailSeconds).toBeUndefined();
  });
});

describe('the video export holds the last frame through the tail', () => {
  const timeline = makeTimeline([{ start: 0.5, end: 1.5, string: 3, fret: 5 }], 2, 2, 6);

  function start(audio: PcmAudio): StartMessage {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(message: unknown) {
        posted.push(message);
      }
      terminate() {}
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    try {
      void startExport({ timeline, trackIndex: 0, preset: presetById('landscape'), audio, panels: ['highway', 'tab'], view: { lookahead: 4 }, onProgress: () => {} }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    return posted[0] as StartMessage;
  }

  const silence = (seconds: number, tailSeconds?: number): PcmAudio => ({
    left: new Float32Array(samplesFor(seconds)),
    right: new Float32Array(samplesFor(seconds)),
    sampleRate: AUDIO_SAMPLE_RATE,
    ...(tailSeconds === undefined ? {} : { tailSeconds }),
  });

  it('lasts the tab length plus the tail, and keeps the tail in the audio', () => {
    const tail = DEFAULT_EFFECTS.roomSeconds;
    const message = start(silence(timeline.durationSeconds + tail, tail));
    expect(message.outputSeconds).toBeCloseTo(timeline.durationSeconds + tail, 9);
    expect(message.audio.left.length).toBe(samplesFor(timeline.durationSeconds + tail));
  });

  it('lasts the tab length when the audio has no tail, as before', () => {
    const message = start(silence(timeline.durationSeconds + 0.5));
    expect(message.outputSeconds).toBe(timeline.durationSeconds);
    expect(message.audio.left.length).toBe(samplesFor(timeline.durationSeconds));
  });

  it('repeats the final frame for every frame past the tab end', () => {
    const fps = presetById('landscape').fps;
    const tail = DEFAULT_EFFECTS.roomSeconds;
    const total = frameCount(timeline.durationSeconds + tail, fps);
    const tabFrames = frameCount(timeline.durationSeconds, fps);
    const draw = (t: number) => {
      const { ctx, calls } = createRecordingContext();
      renderStageFrame(ctx as unknown as FrameContext, timeline, 0, t, 1920, 1080, ['highway', 'tab'], { lookahead: 4 });
      return calls;
    };
    const times = Array.from({ length: total }, (_, f) => frameTabTime(null, frameTime(f, fps), timeline.durationSeconds));
    // Frames inside the tab are untouched.
    for (let f = 0; f < tabFrames; f++) expect(times[f]).toBe(frameTime(f, fps));
    const tailTimes = times.slice(tabFrames);
    expect(tailTimes.length).toBeGreaterThan(0);
    for (const t of tailTimes) expect(t).toBe(timeline.durationSeconds);
    const final = draw(timeline.durationSeconds);
    expect(draw(tailTimes[0])).toEqual(final);
    expect(draw(tailTimes[tailTimes.length - 1])).toEqual(final);
  });
});
