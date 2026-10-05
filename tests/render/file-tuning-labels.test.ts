import { describe, expect, it } from 'vitest';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { FILE_TUNING, presetById, retuneTimeline } from '../../src/model/retune';
import { noteName, spellingForTuning } from '../../src/render/note-names';
import { renderFretboard } from '../../src/render/fretboard';
import { createRecordingContext } from '../helpers/recording-context';

// Regression: a file in E standard must show E A D G B E, never Eb Ab Db Gb Bb Eb, when the picker
// says "File's tuning". File tuning, display transposition and a chosen tuning are separate things.
const E_STANDARD_MIDI = [64, 59, 55, 50, 45, 40];
const E_STANDARD_NAMES = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];
const FILE = String.raw`\title "T" \tempo 100
\track "Guitar" \staff {tabs} \tuning E4 B3 G3 D3 A2 E2
:4 0.6 3.5 5.4 7.3 |`;

// what App does: FILE_TUNING is not a preset, so the timeline is shown untouched
function shownTimeline(tuningId: string) {
  const source = buildTimeline(loadAlphaTex(FILE));
  const preset = presetById(tuningId);
  return preset ? retuneTimeline(source, 0, preset.tuning) : source;
}

function rowLabels(timeline: ReturnType<typeof shownTimeline>): string[] {
  const { ctx, calls } = createRecordingContext();
  renderFretboard(ctx, timeline, 0, 0.1, 1100, 300, {});
  return calls
    .filter((c) => c.name === 'fillText' && c.args[1] === 24)
    .sort((a, b) => (a.args[2] as number) - (b.args[2] as number))
    .map((c) => c.args[0] as string);
}

describe("File's tuning on an E-standard file", () => {
  it('reads the six open strings exactly as the file wrote them', () => {
    const timeline = shownTimeline(FILE_TUNING);
    expect([...timeline.tracks[0].tuning]).toEqual(E_STANDARD_MIDI);
  });

  it('labels the fretboard rows E A D G B E, not Eb Ab Db Gb Bb Eb', () => {
    expect(rowLabels(shownTimeline(FILE_TUNING))).toEqual(['E', 'B', 'G', 'D', 'A', 'E']);
  });

  it('maps open-string fret 0 to E2 A2 D3 G3 B3 E4', () => {
    const tuning = shownTimeline(FILE_TUNING).tracks[0].tuning;
    const octave = (midi: number) => `${noteName(midi, spellingForTuning(tuning))}${Math.floor(midi / 12) - 1}`;
    // tuning is highest string first; strings 6..1 are E2 A2 D3 G3 B3 E4
    expect([...tuning].reverse().map(octave)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(tuning.map(octave)).toEqual(E_STANDARD_NAMES);
  });

  it('uses sharps-style spelling for E standard', () => {
    expect(spellingForTuning(E_STANDARD_MIDI)).toBe('sharps');
  });

  it('only changes the labels when the user explicitly picks another tuning', () => {
    expect(rowLabels(shownTimeline('half-down'))).toEqual(['Eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb']);
    expect(rowLabels(shownTimeline(FILE_TUNING))).toEqual(['E', 'B', 'G', 'D', 'A', 'E']);
  });
});
