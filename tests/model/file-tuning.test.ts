import { describe, expect, it } from 'vitest';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { applyFileTuning, captureTunings } from '../../src/model/file-tuning';
import { presetById } from '../../src/model/retune';

const TWO_TRACKS = String.raw`\title "T" \tempo 100
\track "Guitar" \staff {tabs} \tuning E4 B3 G3 D3 A2 E2
:4 0.6 3.6 5.6 7.6 |
\track "Bass" \staff {tabs} \tuning G2 D2 A1 E1
:4 0.4 3.4 5.4 7.4 |`;

const std = presetById('standard')!.tuning;
const half = presetById('half-down')!.tuning;
const dropD = presetById('drop-d')!.tuning;

function open() {
  const score = loadAlphaTex(TWO_TRACKS);
  return { score, original: captureTunings(score) };
}

describe('applyFileTuning', () => {
  it('relabels the guitar as half a step down and moves the sound with it, leaving frets alone', () => {
    const { score, original } = open();
    const before = buildTimeline(score);
    const noteBefore = before.notesForTrack(0)[1];
    applyFileTuning(score, original, 0, half);
    const after = buildTimeline(score);
    expect(after.tracks[0].tuning).toEqual(half);
    const noteAfter = after.notesForTrack(0)[1];
    expect([noteAfter.string, noteAfter.fret]).toEqual([noteBefore.string, noteBefore.fret]);
    expect(score.tracks[0].staves[0].tuning[5]).toBe(std[5] - 1);
  });

  it('shifts the other pitched tracks by the same amount when the change is a uniform shift', () => {
    const { score, original } = open();
    applyFileTuning(score, original, 0, half);
    const bass = buildTimeline(score).tracks[1].tuning;
    expect(bass).toEqual(original[1][0].map((m) => m - 1));
  });

  it('changes only the chosen track when the new tuning is not a uniform shift', () => {
    const { score, original } = open();
    applyFileTuning(score, original, 0, dropD);
    const t = buildTimeline(score);
    expect(t.tracks[0].tuning).toEqual(dropD);
    expect(t.tracks[1].tuning).toEqual(original[1][0]);
  });

  it('works from the original each time, so choices never add up', () => {
    const { score, original } = open();
    applyFileTuning(score, original, 0, half);
    applyFileTuning(score, original, 0, half);
    expect(buildTimeline(score).tracks[0].tuning).toEqual(half);
    applyFileTuning(score, original, 0, null);
    expect(buildTimeline(score).tracks[0].tuning).toEqual(std);
    expect(buildTimeline(score).tracks[1].tuning).toEqual(original[1][0]);
  });

  it('can be set back to standard from a file that was written down a step', () => {
    const { score, original } = open();
    applyFileTuning(score, original, 0, half);
    const written = captureTunings(score);
    applyFileTuning(score, written, 0, std);
    expect(buildTimeline(score).tracks[0].tuning).toEqual(std);
  });

  it('ignores a tuning with a different string count', () => {
    const { score, original } = open();
    applyFileTuning(score, original, 0, [40, 35, 31, 26]);
    expect(buildTimeline(score).tracks[0].tuning).toEqual(std);
  });
});
