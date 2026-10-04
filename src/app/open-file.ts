import type { model as AlphaModel } from '@coderline/alphatab';
import { buildTimeline, loadScoreFromBytes } from '../model/alphatab-adapter';
import type { Timeline } from '../model/score';

export interface OpenedTab {
  score: AlphaModel.Score;
  timeline: Timeline;
}

export function firstPlayableTrack(timeline: Timeline): number {
  return timeline.tracks.find((t) => !t.isPercussion)?.index ?? 0;
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
