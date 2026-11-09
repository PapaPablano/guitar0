import type { model as AlphaModel } from '@coderline/alphatab';
import { isGuitarProgram } from '../audio/guitar-tone';
import { buildTimeline, loadScoreFromBytes } from '../model/alphatab-adapter';
import type { Timeline } from '../model/score';
import { playsInOpening } from './auto-align';

export interface OpenedTab {
  score: AlphaModel.Score;
  timeline: Timeline;
}

/**
 * The track the page opens on: the first guitar that plays in the opening, as the line-up with a recording uses it as its
 * reference and a vocal or lead line that waits bars to come in gives it nothing to match. Failing that, the first guitar with
 * notes, then the first pitched track.
 */
export function firstPlayableTrack(timeline: Timeline): number {
  const pitched = timeline.tracks.filter((t) => !t.isPercussion);
  const guitars = pitched.filter((t) => isGuitarProgram(t.program) && timeline.notesForTrack(t.index).length > 0);
  const chosen = guitars.find((t) => playsInOpening(timeline.notesForTrack(t.index))) ?? guitars[0] ?? pitched[0];
  return chosen?.index ?? 0;
}

/** Parses a tab file. Throws an Error whose message is safe to show to the user. */
export function openTabBytes(bytes: Uint8Array): OpenedTab {
  let score: AlphaModel.Score;
  let timeline: Timeline;
  try {
    score = loadScoreFromBytes(bytes);
    timeline = buildTimeline(score);
  } catch {
    throw new Error('Could not open that file. Is it a Guitar Pro or MusicXML tab?');
  }
  if (timeline.notesForTrack(firstPlayableTrack(timeline)).length === 0) {
    throw new Error('That file has no playable guitar notes.');
  }
  return { score, timeline };
}
