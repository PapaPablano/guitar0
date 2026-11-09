import { OFFSET_MAX_SECONDS, OFFSET_MIN_SECONDS } from '../audio/offset-range';

export type SyncResult = { ok: true; offset: number } | { ok: false; message: string };

/**
 * The offset that puts the tab's first note at the moment the player has scrubbed the video to: the video position minus
 * the tab time of that first note. An offset outside the shared range is refused, never stored clamped.
 */
export function syncHereOffset(videoSeconds: number, firstNoteTabSeconds: number): SyncResult {
  const offset = Math.round((videoSeconds - firstNoteTabSeconds) * 1000) / 1000;
  if (!Number.isFinite(offset) || offset < OFFSET_MIN_SECONDS || offset > OFFSET_MAX_SECONDS) {
    return {
      ok: false,
      message: `The video is more than ${OFFSET_MAX_SECONDS} seconds from the tab's start, which is further than the offset can move it. Choose a video that starts closer to the song.`,
    };
  }
  return { ok: true, offset };
}

/** The tab time of the first pitched note in any track, which a player lines the video's first note up with; 0 when there are none. */
export function firstNoteSeconds(timeline: {
  readonly tracks: readonly { readonly index: number; readonly isPercussion: boolean }[];
  notesForTrack(trackIndex: number): readonly { readonly startSeconds: number }[];
}): number {
  let first = Infinity;
  for (const track of timeline.tracks) {
    if (track.isPercussion) continue;
    const note = timeline.notesForTrack(track.index)[0];
    if (note && note.startSeconds < first) first = note.startSeconds;
  }
  return Number.isFinite(first) ? first : 0;
}
