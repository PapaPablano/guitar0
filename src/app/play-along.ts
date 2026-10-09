import type { TrackInfo } from '../model/score';

/** True when "Play along" makes sense for the viewed track: a pitched track with at least one other track to hear. */
export function canPlayAlong(tracks: readonly TrackInfo[], viewed: number): boolean {
  const track = tracks.find((t) => t.index === viewed);
  return track !== undefined && !track.isPercussion && tracks.length > 1;
}

/** The track "Play along" silences: the viewed one while the switch is on, otherwise none. */
export function silentTrackFor(on: boolean, tracks: readonly TrackInfo[], viewed: number): number | null {
  return on && canPlayAlong(tracks, viewed) ? viewed : null;
}
