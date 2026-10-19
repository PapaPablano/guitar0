import { playbackBarIndexAt } from '../model/bars';
import type { NoteEvent, Timeline } from '../model/score';
import { clampLookahead, DEFAULT_LOOKAHEAD, stepsAt, type Step } from './fretboard-steps';
import type { LoopBars } from './tab-strip';

export { isSounding } from './sounding';

/**
 * Everything the views need to agree on at one instant: which notes are sounding, which step is
 * playing and which come next, the bar being played and the loop. Built once per frame by whoever
 * draws the frame (the page, the full-screen view, the export) and handed to every view, so no view
 * works out for itself whether a note is lit.
 */
export interface Moment {
  readonly t: number;
  readonly trackIndex: number;
  /** Index into `timeline.bars` of the bar being played at `t`. */
  readonly playbackBar: number;
  /** Ids of every note sounding at `t`, including a long note held under later steps. */
  readonly sounding: ReadonlySet<string>;
  /** The same notes as `sounding`, for the views that draw them. */
  readonly soundingNotes: readonly NoteEvent[];
  /** The latest started step while any of its notes sounds; null in a gap. */
  readonly playing: Step | null;
  /** The next steps, nearest first. */
  readonly upcoming: readonly Step[];
  /** The steps just before the playing one, most recent first; empty in a gap. */
  readonly trail: readonly Step[];
  /** Whole number of upcoming steps the dot views look ahead, from 1 to 8. */
  readonly lookahead: number;
  readonly loop: LoopBars | null;
}

export interface MomentOptions {
  readonly lookahead?: number;
  readonly loop?: LoopBars | null;
}

/** The longest note of each track, so the sounding scan knows how far back a held note can start. */
const longestNote = new WeakMap<readonly NoteEvent[], number>();

function longestOf(notes: readonly NoteEvent[]): number {
  let longest = longestNote.get(notes);
  if (longest === undefined) {
    longest = 0;
    for (const n of notes) longest = Math.max(longest, n.endSeconds - n.startSeconds);
    longestNote.set(notes, longest);
  }
  return longest;
}

/** Index of the last note starting at or before `t`, or -1. Notes come ordered by start. */
function lastStartedNote(notes: readonly NoteEvent[], t: number): number {
  let lo = 0;
  let hi = notes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startSeconds <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * The notes that started at or before `t` and have not ended more than `graceSeconds` ago: the sounding notes for a
 * grace of 0, and those plus the ones that just ended for a longer one (the neck's slide comets use 0.2 s).
 */
export function notesActiveWithin(notes: readonly NoteEvent[], t: number, graceSeconds: number): NoteEvent[] {
  const found: NoteEvent[] = [];
  const earliest = t - longestOf(notes) - graceSeconds;
  for (let i = lastStartedNote(notes, t); i >= 0 && notes[i].startSeconds >= earliest; i--) {
    if (t < notes[i].endSeconds + graceSeconds) found.push(notes[i]);
  }
  return found.reverse();
}

/** The moment at playback time `t` for one track. A pure function of the timeline, the track and the time. */
export function momentAt(timeline: Timeline, trackIndex: number, t: number, options: MomentOptions = {}): Moment {
  const notes = timeline.notesForTrack(trackIndex);
  const lookahead = clampLookahead(options.lookahead ?? DEFAULT_LOOKAHEAD);
  const steps = stepsAt(notes, t, lookahead);
  const soundingNotes = notesActiveWithin(notes, t, 0);
  return {
    t,
    trackIndex,
    playbackBar: playbackBarIndexAt(timeline, t),
    sounding: new Set(soundingNotes.map((n) => n.id)),
    soundingNotes,
    playing: steps.playing,
    upcoming: steps.upcoming,
    trail: steps.trail,
    lookahead,
    loop: options.loop ?? null,
  };
}
