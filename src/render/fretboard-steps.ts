import type { NoteEvent } from '../model/score';

/** Notes that start together (a chord is one step), in playback order. */
export interface Step {
  readonly tick: number;
  readonly startSeconds: number;
  readonly notes: readonly NoteEvent[];
}

export interface FretboardSteps {
  /** The latest step that has started; it stays until the next step starts. Null before the first note. */
  readonly playing: Step | null;
  /** The next steps, nearest first. */
  readonly upcoming: readonly Step[];
  /** The steps just before the playing one, most recent first. */
  readonly trail: readonly Step[];
}

export const MIN_LOOKAHEAD = 1;
export const MAX_LOOKAHEAD = 8;
export const DEFAULT_LOOKAHEAD = 4;
export const TRAIL_STEPS = 3;

/** Whole look-ahead from 1 to 8; anything that is not a number falls back to the default. */
export function clampLookahead(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_LOOKAHEAD;
  return Math.min(MAX_LOOKAHEAD, Math.max(MIN_LOOKAHEAD, Math.round(n)));
}

const stepCache = new WeakMap<readonly NoteEvent[], readonly Step[]>();

/** Groups a track's notes into steps. The notes come in playback order, so repeats are played again. */
export function groupSteps(notes: readonly NoteEvent[]): readonly Step[] {
  let steps = stepCache.get(notes);
  if (steps) return steps;
  const built: { tick: number; startSeconds: number; notes: NoteEvent[] }[] = [];
  for (const note of notes) {
    const last = built[built.length - 1];
    if (last && last.tick === note.tick) last.notes.push(note);
    else built.push({ tick: note.tick, startSeconds: note.startSeconds, notes: [note] });
  }
  steps = built;
  stepCache.set(notes, steps);
  return steps;
}

/** Index of the last step starting at or before `t`, or -1 when none has started. */
function lastStartedStep(steps: readonly Step[], t: number): number {
  let lo = 0;
  let hi = steps.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].startSeconds <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** What to show on the fretboard at time `t`: the playing step, the next ones and the trail. */
export function stepsAt(notes: readonly NoteEvent[], t: number, lookahead: number): FretboardSteps {
  const steps = groupSteps(notes);
  const count = clampLookahead(lookahead);
  const index = lastStartedStep(steps, t);
  return {
    playing: index >= 0 ? steps[index] : null,
    upcoming: steps.slice(index + 1, index + 1 + count),
    trail: steps.slice(Math.max(0, index - TRAIL_STEPS), Math.max(0, index)).reverse(),
  };
}

/** The highest fret any note uses; 0 for an empty track. */
export function maxFretUsed(notes: readonly NoteEvent[]): number {
  let max = 0;
  for (const note of notes) max = Math.max(max, note.fret);
  return max;
}
