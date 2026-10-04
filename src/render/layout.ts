import type { NoteEvent } from '../model/score';

// Pure geometry for the highway. Strings run horizontally, notes travel right to left and
// reach the strikeline at the moment they sound.

export interface HighwayLayout {
  readonly width: number;
  readonly height: number;
  readonly stringCount: number;
  /** X of the strikeline. */
  readonly strikeX: number;
  /** Top of the first (highest-pitched) lane and the height of each lane. */
  readonly laneTop: number;
  readonly laneHeight: number;
  readonly pxPerSecond: number;
  /** Seconds visible to the right of the strikeline. */
  readonly lookaheadSeconds: number;
  /** Seconds visible to the left of the strikeline. */
  readonly lookbehindSeconds: number;
  /** Radius of a note head. */
  readonly noteRadius: number;
}

export const DEFAULT_LOOKAHEAD_SECONDS = 3;

export function computeLayout(
  width: number,
  height: number,
  stringCount: number,
  lookaheadSeconds: number = DEFAULT_LOOKAHEAD_SECONDS,
): HighwayLayout {
  const strings = Math.max(1, stringCount);
  const strikeX = Math.round(width * 0.18);
  const laneTop = height * 0.12;
  const laneHeight = (height * 0.8) / strings;
  const rightMargin = Math.min(24, width * 0.02);
  const pxPerSecond = Math.max(1, (width - strikeX - rightMargin) / lookaheadSeconds);
  return {
    width,
    height,
    stringCount: strings,
    strikeX,
    laneTop,
    laneHeight,
    pxPerSecond,
    lookaheadSeconds,
    lookbehindSeconds: strikeX / pxPerSecond,
    noteRadius: Math.max(4, Math.min(laneHeight * 0.42, 18)),
  };
}

/** Vertical centre of a lane; string 1 (highest pitched) is the top lane. */
export function laneY(layout: HighwayLayout, string: number): number {
  return layout.laneTop + (string - 0.5) * layout.laneHeight;
}

/** True while the note is sounding at playhead time `t`. */
export function isActive(note: NoteEvent, t: number): boolean {
  return note.startSeconds <= t && t < note.endSeconds;
}

/** X of a note's head: pinned to the strikeline while it sounds, scrolling otherwise. */
export function noteX(layout: HighwayLayout, note: NoteEvent, t: number): number {
  return isActive(note, t) ? layout.strikeX : timeToX(layout, note.startSeconds, t);
}

/** X position of a point in time when the playhead is at `t`. */
export function timeToX(layout: HighwayLayout, time: number, t: number): number {
  return layout.strikeX + (time - t) * layout.pxPerSecond;
}
