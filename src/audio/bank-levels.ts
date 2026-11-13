/**
 * Measures how loud each program of a sound bank plays, so `track-balance.ts` can bring every bank's guitars and bass to one
 * level. One fixed reference riff is rendered alone through each program by alphaTab's own synth and its RMS is taken.
 *
 * This file imports nothing but alphaTab, so `dev/measure-bank-levels.ts` can run it straight under Node.
 */
import * as alphaTab from '@coderline/alphatab';

/** The riff's notes as MIDI keys for a guitar: E2, B2, E3, B2, played twice, as a low open-string arpeggio. */
const GUITAR_RIFF = [40, 47, 52, 47, 40, 47, 52, 47];
/** Bass programs (32 to 39) play the same riff an octave lower, where a bass part sits. */
const BASS_OCTAVE_SHIFT = -12;
/** Eighth notes at 120 bpm (half a second per beat), each held for its full length: the riff lasts 4 seconds. */
const EIGHTH = 480; // MIDI ticks; alphaTab counts 960 to a quarter note
const MICROSECONDS_PER_QUARTER = 500_000;
/**
 * What alphaTab's score-to-MIDI writes for a track at its defaults: velocity for forte (15 + 5 * 16), channel volume for
 * a track volume of 15 (15 * 8), full expression.
 */
const VELOCITY = 95;
const CHANNEL_VOLUME = 120;
const EXPRESSION = 127;
const SAMPLE_RATE = 44100;
/** How much audio each render call asks for, in milliseconds. */
const CHUNK_MS = 500;

/** The reference riff for one program, alone on channel 0 at bank 0, as alphaTab MIDI. */
export function referenceRiff(program: number): alphaTab.midi.MidiFile {
  const { midi } = alphaTab;
  const file = new midi.MidiFile();
  file.addEvent(new midi.TempoChangeEvent(0, MICROSECONDS_PER_QUARTER));
  file.addEvent(new midi.ControlChangeEvent(0, 0, 0, midi.ControllerType.VolumeCoarse, CHANNEL_VOLUME));
  file.addEvent(new midi.ControlChangeEvent(0, 0, 0, midi.ControllerType.ExpressionControllerCoarse, EXPRESSION));
  file.addEvent(new midi.ControlChangeEvent(0, 0, 0, midi.ControllerType.BankSelectCoarse, 0));
  file.addEvent(new midi.ControlChangeEvent(0, 0, 0, midi.ControllerType.BankSelectFine, 0));
  file.addEvent(new midi.ProgramChangeEvent(0, 0, 0, program));
  const shift = program >= 32 && program <= 39 ? BASS_OCTAVE_SHIFT : 0;
  let tick = 0;
  for (const key of GUITAR_RIFF) {
    file.addEvent(new midi.NoteOnEvent(0, tick, 0, key + shift, VELOCITY));
    file.addEvent(new midi.NoteOffEvent(0, tick + EIGHTH, 0, key + shift, 0));
    tick += EIGHTH;
  }
  file.addEvent(new midi.EndOfTrackEvent(0, tick));
  return file;
}

/** Root mean square of the samples in the given buffers, taken together as one signal; 0 when there are none. */
export function rms(...buffers: readonly Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const buffer of buffers) {
    for (const sample of buffer) sum += sample * sample;
    count += buffer.length;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/** An output alphaTab's synth needs to exist; the exporter renders without ever using it. */
const SILENT_OUTPUT = {
  sampleRate: SAMPLE_RATE,
  ready: { on() {} },
  sampleRequest: { on() {} },
  samplesPlayed: { on() {} },
  open() {},
} as unknown as alphaTab.synth.ISynthOutput;

/** Renders the reference riff for one program through the given banks (in layering order) and returns all its samples. */
function renderRiff(banks: readonly Uint8Array[], program: number): Float32Array[] {
  const synth = new alphaTab.synth.AlphaSynth(SILENT_OUTPUT, 100);
  const options = new alphaTab.synth.AudioExportOptions();
  options.sampleRate = SAMPLE_RATE;
  options.soundFonts = [...banks];
  const exporter = synth.exportAudio(options, referenceRiff(program), [], new Map());
  const chunks: Float32Array[] = [];
  for (let chunk = exporter.render(CHUNK_MS); chunk; chunk = exporter.render(CHUNK_MS)) chunks.push(chunk.samples);
  return chunks;
}

/**
 * The RMS of the reference riff played alone through each program, with the banks loaded in layering order (later banks
 * win for the programs they cover). A program no bank can play measures about 0. For a player's bank, pass MuseScore
 * General first and measure only the programs the bank covers, or the table would record MuseScore General's levels.
 *
 * This renders synchronously, about 0.1 to 0.3 s per program with MuseScore General loaded.
 */
export function measureLevels(banks: readonly Uint8Array[], programs: readonly number[]): Record<number, number> {
  const levels: Record<number, number> = {};
  for (const program of programs) levels[program] = rms(...renderRiff(banks, program));
  return levels;
}
