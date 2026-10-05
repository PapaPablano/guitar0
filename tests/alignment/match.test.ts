import { describe, expect, it } from 'vitest';
import { chromaFrames, FEATURE_RATE, onsetEnvelope } from '../../src/alignment/features';
import { matchRecording, type MatchResult } from '../../src/alignment/match';
import {
  concat,
  inserted,
  noise,
  removed,
  renderSong,
  seeded,
  shifted,
  silence,
  songNotes,
  unrelatedMusic,
} from '../helpers/synthetic-audio';

const R = FEATURE_RATE;
const BARS = 30;
const BAR_SECONDS = 2;
const SONG_SECONDS = BARS * BAR_SECONDS;

const barLines = (count = BARS, barSeconds = BAR_SECONDS) => Array.from({ length: count }, (_, i) => i * barSeconds);

/** The tab as the synthesizer would play it, and the same song in a richer timbre as a stand-in for a recording. */
const notes = songNotes(BARS, BAR_SECONDS, 11);
const tab = renderSong(notes, SONG_SECONDS, R, 'plain');
const recordingOfSong = renderSong(notes, SONG_SECONDS, R, 'rich', 17);

function run(recording: Float32Array, tabSamples = tab, bars = barLines()): MatchResult {
  return matchRecording({
    recording: chromaFrames(recording, R),
    tab: chromaFrames(tabSamples, R),
    recordingOnsets: onsetEnvelope(recording, R),
    tabOnsets: onsetEnvelope(tabSamples, R),
    barLines: bars,
  });
}

function aligned(result: MatchResult) {
  expect(result.kind).toBe('aligned');
  if (result.kind !== 'aligned') throw new Error('not aligned');
  return result;
}

describe('matchRecording', () => {
  it('covers AE1: a recording with 1.5 s of lead-in gives that base offset and no holds', () => {
    const result = aligned(run(shifted(recordingOfSong, 1.5, R)));
    expect(Math.abs(result.map.base - 1.5)).toBeLessThanOrEqual(0.03);
    expect(result.map.holds).toEqual([]);
  });

  it('gives a negative base offset for a recording that starts after the tab', () => {
    const result = aligned(run(shifted(recordingOfSong, -2, R)));
    expect(Math.abs(result.map.base + 2)).toBeLessThanOrEqual(0.03);
    expect(result.map.holds).toEqual([]);
  });

  it('covers AE2: eight bars of other playing inserted at a bar line give one hold there, of that length', () => {
    const extra = unrelatedMusic(16, R);
    const recording = shifted(inserted(recordingOfSong, 20, extra, R), 1.5, R);
    const result = aligned(run(recording));
    expect(Math.abs(result.map.base - 1.5)).toBeLessThanOrEqual(0.03);
    expect(result.map.holds).toHaveLength(1);
    expect(result.map.holds[0].at).toBe(20);
    expect(Math.abs(result.map.holds[0].length - 16)).toBeLessThanOrEqual(0.05);
    // the tab after the hold lines up with the recording again
    expect(result.map.toRec(30, 'start')).toBeCloseTo(30 + 1.5 + 16, 1);
  });

  it('finds two separate extra sections, in order', () => {
    let recording = inserted(recordingOfSong, 12, unrelatedMusic(6, R, 301), R);
    recording = inserted(recording, 46, unrelatedMusic(10, R, 302), R); // 40 s of tab plus the 6 s already inserted
    const result = aligned(run(recording));
    expect(result.map.holds.map((h) => h.at)).toEqual([12, 40]);
    expect(Math.abs(result.map.holds[0].length - 6)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(result.map.holds[1].length - 10)).toBeLessThanOrEqual(0.05);
  });

  it('absorbs an inserted run shorter than a second as timing noise', () => {
    const recording = inserted(recordingOfSong, 20, noise(0.6, R), R);
    const result = aligned(run(recording));
    expect(result.map.holds).toEqual([]);
    expect(Math.abs(result.map.base)).toBeLessThanOrEqual(0.05);
  });

  it('never makes a negative hold when the recording skips bars', () => {
    const recording = shifted(removed(recordingOfSong, 20, 4, R), 1.5, R);
    const result = aligned(run(recording));
    expect(result.map.holds).toEqual([]);
    expect(Math.abs(result.map.base - 1.5)).toBeLessThanOrEqual(0.03);
  });

  it('puts an extra section that starts in the middle of a bar on the nearest bar line', () => {
    const recording = inserted(recordingOfSong, 20.7, unrelatedMusic(8, R, 303), R);
    const result = aligned(run(recording));
    expect(result.map.holds).toHaveLength(1);
    expect(result.map.holds[0].at % BAR_SECONDS).toBe(0);
    expect(Math.abs(result.map.holds[0].at - 20.7)).toBeLessThanOrEqual(BAR_SECONDS);
    expect(Math.abs(result.map.holds[0].length - 8)).toBeLessThanOrEqual(0.1);
  });

  it('still matches a recording that follows a tab with a tempo change', () => {
    const slowNotes = songNotes(10, 2, 21).concat(songNotes(10, 1.6, 22).map((n) => ({ ...n, start: n.start + 20 })));
    const seconds = 20 + 16;
    const bars = [...Array.from({ length: 10 }, (_, i) => i * 2), ...Array.from({ length: 10 }, (_, i) => 20 + i * 1.6)];
    const tabSamples = renderSong(slowNotes, seconds, R, 'plain');
    const recording = shifted(renderSong(slowNotes, seconds, R, 'rich', 5), 0.8, R);
    const result = aligned(run(recording, tabSamples, bars));
    expect(Math.abs(result.map.base - 0.8)).toBeLessThanOrEqual(0.03);
    expect(result.map.holds).toEqual([]);
  });

  it('covers AE3: unrelated music, silence and noise are not found', () => {
    expect(run(unrelatedMusic(SONG_SECONDS, R, 777)).kind).toBe('not-found');
    expect(run(silence(SONG_SECONDS, R)).kind).toBe('not-found');
    expect(run(noise(SONG_SECONDS, R, 9)).kind).toBe('not-found');
  });

  it('ignores silence before and after the recording', () => {
    const result = aligned(run(concat(silence(3, R), recordingOfSong, silence(5, R))));
    expect(Math.abs(result.map.base - 3)).toBeLessThanOrEqual(0.03);
    expect(result.map.holds).toEqual([]);
  });

  it('survives a second song and a different random fixture', () => {
    const random = seeded(99);
    const otherNotes = songNotes(24, 2, 31);
    const otherTab = renderSong(otherNotes, 48, R, 'plain');
    const lead = Math.round((0.5 + random() * 3) * 100) / 100;
    const recording = shifted(renderSong(otherNotes, 48, R, 'rich', 41), lead, R);
    const result = aligned(run(recording, otherTab, barLines(24)));
    expect(Math.abs(result.map.base - lead)).toBeLessThanOrEqual(0.03);
  });
});
