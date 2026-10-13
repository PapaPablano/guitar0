import type { BarEvent, NoteEvent } from '../model/score';

/**
 * The picking hand, as pure functions of the notes and the time: which notes are picked and in which stroke, where the pick is
 * on the strings, which strings it has just flashed, and how hard each plucked string is still shaking. Nothing reads a clock,
 * so an exported frame matches the screen at the same time.
 */

/** A flash lasts this long after the pick reaches a string, fading as it goes. */
export const FLASH_SECONDS = 0.12;
/** A plucked string shakes for this long after the pick reaches it, settling as it goes. */
export const PLUCK_SECONDS = 0.35;
/** The shake rate of a plucked string, in turns per second. */
export const PLUCK_HERTZ = 9;
/** A chord is crossed in this long, from its first string to its last. */
export const STRUM_SECONDS = 0.05;
/** The pick moves to the next string over this long, ending as that note starts. */
export const PICK_TRAVEL_SECONDS = 0.1;
/** Midi ticks in a quarter note, the beat unmarked strokes alternate on. */
const TICKS_PER_BEAT = 960;
/** Where the pick rests before the first note, across the middle of six strings. */
const REST_STRING = 3.5;

export type Stroke = 'down' | 'up';

/** A note the pick reaches, and when. */
export interface PickReach {
  readonly note: NoteEvent;
  readonly at: number;
}

/** The notes picked together in one stroke, in the order the pick reaches them. */
export interface PickStep {
  readonly start: number;
  readonly stroke: Stroke;
  readonly reaches: readonly PickReach[];
}

export interface PickPlan {
  readonly steps: readonly PickStep[];
  /** When the pick reaches each picked note, by note id. Notes the pick does not play are absent. */
  readonly arrival: ReadonlyMap<string, number>;
}

/** A note the pick plays: not the end of a hammer-on or pull-off, and not a tied continuation. */
export function isPicked(note: NoteEvent): boolean {
  return note.techniques.hammerPull !== 'destination' && !note.techniques.tied;
}

const cache = new WeakMap<readonly NoteEvent[], { bars: readonly BarEvent[] | undefined; plan: PickPlan }>();

/**
 * The picked steps of a track. A stroke the file marks is used as marked. Without a mark a single note is down on the beat and up
 * between beats, counted from the start of its bar when `bars` is given, and a chord is a down stroke.
 */
export function pickPlan(notes: readonly NoteEvent[], bars?: readonly BarEvent[]): PickPlan {
  const hit = cache.get(notes);
  if (hit && hit.bars === bars) return hit.plan;
  const picked = notes.filter(isPicked).sort((a, b) => a.startSeconds - b.startSeconds || a.string - b.string);
  const groups: NoteEvent[][] = [];
  for (const note of picked) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0].startSeconds - note.startSeconds) < 0.002) last.push(note);
    else groups.push([note]);
  }
  const steps: PickStep[] = groups.map((group, i) => {
    const start = group[0].startSeconds;
    const stroke = strokeOf(group, bars);
    const next = groups[i + 1]?.[0].startSeconds ?? Infinity;
    // down crosses from the lowest-pitched string (the highest number) to the highest-pitched; up the other way
    const ordered = [...group].sort((a, b) => (stroke === 'down' ? b.string - a.string : a.string - b.string));
    const strum = Math.min(STRUM_SECONDS, (next - start) / 2);
    const reaches = ordered.map((note, k) => ({ note, at: start + (ordered.length > 1 ? (k * strum) / (ordered.length - 1) : 0) }));
    return { start, stroke, reaches };
  });
  const arrival = new Map<string, number>();
  for (const step of steps) for (const r of step.reaches) arrival.set(r.note.id, r.at);
  const plan = { steps, arrival };
  cache.set(notes, { bars, plan });
  return plan;
}

function strokeOf(group: readonly NoteEvent[], bars: readonly BarEvent[] | undefined): Stroke {
  const marked = group.find((n) => n.stroke === 'down' || n.stroke === 'up')?.stroke;
  if (marked === 'down' || marked === 'up') return marked;
  if (group.length > 1) return 'down';
  const note = group[0];
  const barStart = bars?.[note.playbackBar]?.startTick ?? 0;
  const offset = note.tick - barStart;
  return Math.abs(offset - Math.round(offset / TICKS_PER_BEAT) * TICKS_PER_BEAT) <= 2 ? 'down' : 'up';
}

/** A string that may be between two, so the pick can sit across the gap while it moves. */
export interface PickState {
  readonly string: number;
  /** The stroke the pick is making, or last made. */
  readonly stroke: Stroke;
  /** True while the pick is crossing a chord or travelling to the next string. */
  readonly moving: boolean;
  /** The strings just reached and how bright each flash still is, 0 to 1. */
  readonly flashes: readonly { readonly note: NoteEvent; readonly string: number; readonly strength: number }[];
}

const smooth = (v: number): number => {
  const x = Math.min(1, Math.max(0, v));
  return x * x * (3 - 2 * x);
};

/** Index of the last step starting at or before `t`, or -1. */
function stepIndexAt(steps: readonly PickStep[], t: number): number {
  let lo = 0;
  let hi = steps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Where the pick is at `t`, and which strings it has just flashed. */
export function pickAt(plan: PickPlan, t: number): PickState {
  const { steps } = plan;
  const i = stepIndexAt(steps, t);
  const flashes: { note: NoteEvent; string: number; strength: number }[] = [];
  for (let k = Math.max(0, i - 1); k <= i; k++) {
    for (const { note, at } of steps[k]?.reaches ?? []) {
      const since = t - at;
      if (since >= 0 && since < FLASH_SECONDS) flashes.push({ note, string: note.string, strength: (1 - since / FLASH_SECONDS) ** 2 });
    }
  }
  const next = steps[i + 1];
  const current = steps[i];

  // across the strings of the step being played
  if (current) {
    const { reaches } = current;
    const last = reaches[reaches.length - 1];
    if (t < last.at) {
      const j = reaches.findIndex((r) => r.at > t);
      const a = reaches[Math.max(0, j - 1)];
      const b = reaches[j];
      const u = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
      return { string: a.note.string + (b.note.string - a.note.string) * u, stroke: current.stroke, moving: true, flashes };
    }
    // resting on its last string, until the move to the next step's first string begins
    if (!next) return { string: last.note.string, stroke: current.stroke, moving: false, flashes };
    const target = next.reaches[0].note.string;
    const travel = Math.min(PICK_TRAVEL_SECONDS, next.start - last.at);
    const begin = next.start - travel;
    if (t < begin || travel <= 0) return { string: last.note.string, stroke: current.stroke, moving: false, flashes };
    const u = smooth((t - begin) / travel);
    return { string: last.note.string + (target - last.note.string) * u, stroke: next.stroke, moving: true, flashes };
  }

  // before the first step
  if (!next) return { string: REST_STRING, stroke: 'down', moving: false, flashes };
  const travel = PICK_TRAVEL_SECONDS;
  const begin = next.start - travel;
  if (t < begin) return { string: REST_STRING, stroke: next.stroke, moving: false, flashes };
  const u = smooth((t - begin) / travel);
  return { string: REST_STRING + (next.reaches[0].note.string - REST_STRING) * u, stroke: next.stroke, moving: true, flashes };
}

/**
 * How far a plucked string is pulled across at `t`, from -1 to 1 and positive toward the lower-pitched neighbour: full at the pick,
 * easing out over `PLUCK_SECONDS` as it oscillates. 0 for a note the pick does not play, and outside the pluck.
 */
export function pluckAt(plan: PickPlan, note: NoteEvent, t: number): number {
  const at = plan.arrival.get(note.id);
  if (at === undefined) return 0;
  const since = t - at;
  if (since < 0 || since >= PLUCK_SECONDS) return 0;
  const step = plan.steps[stepIndexAt(plan.steps, at)];
  const sign = step?.stroke === 'up' ? -1 : 1;
  return sign * (1 - since / PLUCK_SECONDS) ** 2 * Math.cos(2 * Math.PI * PLUCK_HERTZ * since);
}
