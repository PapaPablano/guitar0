import { playbackBarIndexAt } from '../model/bars';
import type { NoteEvent, Timeline } from '../model/score';
import { clampLookahead, DEFAULT_LOOKAHEAD, stepsAt, type Step } from './fretboard-steps';
import { visibleNotes } from './note-window';
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

/**
 * The notes that started at or before `t` and have not ended more than `graceSeconds` ago: the sounding notes for a
 * grace of 0, and those plus the ones that just ended for a longer one (the neck's slide comets use 0.2 s).
 */
export function notesActiveWithin(notes: readonly NoteEvent[], t: number, graceSeconds: number): NoteEvent[] {
  return visibleNotes(notes, t - graceSeconds, t).filter((n) => t < n.endSeconds + graceSeconds);
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
