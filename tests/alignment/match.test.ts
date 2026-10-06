import { describe, expect, it } from 'vitest';
import { chromaFrames, FEATURE_RATE, onsetEnvelope } from '../../src/alignment/features';
import { matchRecording, type MatchResult } from '../../src/alignment/match';
import {
  bandPerformance,
  barSpans,
  concat,
  inserted,
  noise,
  removed,
  renderSong,
  seeded,
  shifted,
  silence,
  songNotes,
  structuredSong,
  unrelatedMusic,
} from '../helpers/synthetic-audio';

const R = FEATURE_RATE;
const BARS = 30;
const BAR_SECONDS = 2;
const SONG_SECONDS = BARS * BAR_SECONDS;

const barLines = (count = BARS, barSeconds = BAR_SECONDS) => barSpans(count, barSeconds);

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
    bars,
  });
}

function aligned(result: MatchResult) {
  expect(result.kind).toBe('aligned');
  if (result.kind !== 'aligned') throw new Error('not aligned');
  return result;
}

describe('matchRecording', { timeout: 30000 }, () => {
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
    // the skipped bars are reported as a stretch the tab jumps past
    expect(result.skippedStretches).toBeGreaterThanOrEqual(1);
  });

  it('reports no skipped stretch for a recording that follows the tab', () => {
    expect(aligned(run(shifted(recordingOfSong, 1.5, R))).skippedStretches).toBe(0);
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
    const bars = [...barSpans(10, 2), ...barSpans(10, 1.6, 20)];
    const tabSamples = renderSong(slowNotes, seconds, R, 'plain');
    const recording = shifted(renderSong(slowNotes, seconds, R, 'rich', 5), 0.8, R);
    const result = aligned(run(recording, tabSamples, bars));
    expect(Math.abs(result.map.base - 0.8)).toBeLessThanOrEqual(0.03);
    expect(result.map.holds).toEqual([]);
  });

  it('finds an extra section far into the song to the same accuracy as one near the start', () => {
    const longNotes = songNotes(160, BAR_SECONDS, 71);
    const longTab = renderSong(longNotes, 160 * BAR_SECONDS, R, 'plain');
    const long = renderSong(longNotes, 160 * BAR_SECONDS, R, 'rich', 73);
    const recording = shifted(inserted(long, 280, unrelatedMusic(10, R, 305), R), 0.5, R);
    const result = aligned(run(recording, longTab, barLines(160)));
    expect(result.map.holds).toHaveLength(1);
    expect(result.map.holds[0].at).toBe(280);
    expect(Math.abs(result.map.holds[0].length - 10)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(result.map.base - 0.5)).toBeLessThanOrEqual(0.03);
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

describe('matchRecording anchors', { timeout: 60000 }, () => {
  const bars = barSpans(BARS, BAR_SECONDS);

  function perform(recordedLengths: number[], lead = 1, seed = 11) {
    const played = bandPerformance(notes, bars, recordedLengths, lead);
    const recording = renderSong(played.notes, played.seconds, R, 'rich', seed);
    return { played, result: aligned(run(recording)) };
  }

  const steady = () => bars.map((b) => b.end - b.start);

  it('covers AE1: a band that drifts and jitters is followed bar by bar, every bar within 50 ms', () => {
    const lengths = steady().map((d, k) => d * (1 + 0.03 * Math.sin(k / 3)) + (((k * 37) % 9) - 4) * 0.01);
    const { played, result } = perform(lengths);
    const anchors = result.map.anchorData!.anchors;
    expect(anchors).toHaveLength(BARS);
    const worst = Math.max(...anchors.map((a, k) => Math.abs(a - played.anchors[k])));
    expect(worst).toBeLessThanOrEqual(0.05);
    expect(Math.abs(result.map.anchorData!.endAnchor - played.endAnchor)).toBeLessThanOrEqual(0.05);
  });

  it('gives a steady performance no visible steps: every bar is as long as the tab\'s', () => {
    const { result } = perform(steady());
    const anchors = result.map.anchorData!.anchors;
    for (let k = 1; k < anchors.length; k++) expect(Math.abs(anchors[k] - anchors[k - 1] - BAR_SECONDS)).toBeLessThanOrEqual(0.01);
    expect(result.map.holds).toEqual([]);
  });

  it('covers AE3: eight bars of extra playing make the bar before them record sixteen seconds long', () => {
    const lengths = steady();
    lengths[14] += 16;
    const { played, result } = perform(lengths);
    expect(result.map.holds).toHaveLength(1);
    expect(result.map.holds[0].at).toBe(bars[14].end);
    expect(Math.abs(result.map.holds[0].length - 16)).toBeLessThanOrEqual(0.05);
    const anchors = result.map.anchorData!.anchors;
    const worst = Math.max(...anchors.map((a, k) => Math.abs(a - played.anchors[k])));
    expect(worst).toBeLessThanOrEqual(0.05);
  });

  it('covers AE4: bars the recording skips have the same anchor as the bar after them, and the anchors never decrease', () => {
    const lengths = steady();
    lengths[12] = 0;
    lengths[13] = 0;
    const { played, result } = perform(lengths);
    const anchors = result.map.anchorData!.anchors;
    expect(Math.abs(anchors[12] - played.anchors[12])).toBeLessThanOrEqual(0.05);
    expect(Math.abs(anchors[13] - anchors[12])).toBeLessThanOrEqual(0.05);
    expect(Math.abs(anchors[14] - anchors[12])).toBeLessThanOrEqual(0.05);
    for (let k = 1; k < anchors.length; k++) expect(anchors[k]).toBeGreaterThanOrEqual(anchors[k - 1]);
    expect(Math.abs(anchors[20] - played.anchors[20])).toBeLessThanOrEqual(0.05);
    expect(result.map.holds).toEqual([]);
    expect(result.skippedStretches).toBe(1);
  });

  it('covers AE8: a stretch the recording plays differently is marked unmatched and the bars around it are still followed', () => {
    const lengths = steady();
    const played = bandPerformance(notes, bars, lengths, 1);
    // replace bars 10 to 13 with sound that is nothing like the tab's chords
    const other = noise(8, R, 515, 0.15);
    const recordingNotes = played.notes.filter((n) => n.start < played.anchors[10] || n.start >= played.anchors[14]);
    const recording = renderSong(recordingNotes, played.seconds, R, 'rich', 11);
    const start = Math.round(played.anchors[10] * R);
    for (let i = 0; i < other.length && start + i < recording.length; i++) recording[start + i] += other[i];
    const result = aligned(run(recording));
    expect(result.barMatched.slice(10, 14).every((m) => !m)).toBe(true);
    expect(result.barMatched.slice(2, 8).every((m) => m)).toBe(true);
    expect(result.barMatched.slice(18, 28).every((m) => m)).toBe(true);
    const anchors = result.map.anchorData!.anchors;
    expect(Math.abs(anchors[6] - played.anchors[6])).toBeLessThanOrEqual(0.05);
    expect(Math.abs(anchors[20] - played.anchors[20])).toBeLessThanOrEqual(0.05);
  });

  it('follows a song built from repeating loops, where several offsets look nearly as good as the right one', () => {
    const loops = structuredSong('ABABC', 8);
    const loopTab = renderSong(loops, 80, R, 'plain');
    const spans = barSpans(40, BAR_SECONDS);
    const lengths = spans.map((_, k) => BAR_SECONDS * (1 + 0.015 * Math.sin(k / 3)));
    lengths[20] += 6;
    const played = bandPerformance(loops, spans, lengths, 1);
    const recording = renderSong(played.notes, played.seconds, R, 'rich', 9);
    const result = aligned(run(recording, loopTab, spans));
    const anchors = result.map.anchorData!.anchors;
    const worst = Math.max(...anchors.map((a, k) => Math.abs(a - played.anchors[k])));
    expect(worst).toBeLessThanOrEqual(0.05);
  });

  it('rounds anchors to 10 ms and gives a confidence for every bar', () => {
    const { result } = perform(steady());
    for (const a of result.map.anchorData!.anchors) expect(Math.abs(a * 100 - Math.round(a * 100))).toBeLessThan(1e-6);
    expect(result.barConfidence).toHaveLength(BARS);
    expect(result.barMatched).toHaveLength(BARS);
  });
});

describe('matchRecording with the tab\'s per-bar facts', { timeout: 30000 }, () => {
  it('reads the facts without moving a steady, constant-tempo recording', () => {
    const recording = shifted(recordingOfSong, 1.5, R);
    const features = {
      recording: chromaFrames(recording, R),
      tab: chromaFrames(tab, R),
      recordingOnsets: onsetEnvelope(recording, R),
      tabOnsets: onsetEnvelope(tab, R),
      bars: barLines(),
    };
    const plain = aligned(matchRecording(features));
    const withFacts = aligned(matchRecording({ ...features, barFacts: barLines().map((_, k) => ({ tempo: 120, beats: 4, scoreBar: k })) }));
    expect(withFacts.map.toData()).toEqual(plain.map.toData());
  });
});
