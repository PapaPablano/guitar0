import { bendLabel, fretLabel } from './techniques';
import type { NoteEvent } from '../model/score';

/** Width of the box behind a fret label; the layout uses the same figure to leave each note room. */
export function labelBoxWidth(label: string, fontSize: number): number {
  return Math.max(14, label.length * fontSize * 0.62 + 4);
}

/** Lanes of technique marks above the staff that the layout makes room for; a crowded bar widens rather than add more. */
export const LANE_BUDGET = 3;
/** Font size of a technique mark. */
export const MARK_FONT_SIZE = 10;
/** Clear space kept on each side of a mark, so neighbours do not touch. */
const CLEARANCE = 3;
/** Half-width of the line a bend arrow rises through the lanes below its own. */
const STEM_HALF = 1.5;
/** The arrow of a bend leans this far right of its note's label centre, before clearing numbers above it. */
const ARROW_LEAN = 0.6;
export const ARROW_RUN = 8;
const PM_LABEL = 'P.M.';
export const PM_DASH_FROM = 28;
export const PM_REACH_LEFT = 9;
export const PM_REACH_RIGHT = 8;
/** Lanes searched past the budget before giving up; only a bar with many stacked marks gets that far. */
const MAX_SEARCH_LANES = 8;
/** Smallest widening asked for when a lane is free in text but not for the line dropped through it. */
const MIN_SHIFT = 8;

/** Gap from the staff top to the centre of the first lane, and the least room the lanes are squeezed into. */
const LANE0_OFFSET = 18;
const LANE0_MIN_Y = 9;
const LANE_PITCH_MAX = 13;
const LANE_PITCH_MIN = 11;
const LANE_FLOOR = 5;

/**
 * Y of a lane's centre. The pitch between lanes tightens on a short panel so the whole budget keeps clear of the
 * staff and each other, but never below a legible minimum, and no mark is dropped for lack of room.
 */
export function markLaneY(lineTop: number, lane: number): number {
  const first = Math.max(LANE0_MIN_Y, lineTop - LANE0_OFFSET);
  const pitch = Math.min(LANE_PITCH_MAX, Math.max(LANE_PITCH_MIN, (first - LANE_FLOOR) / (LANE_BUDGET - 1)));
  return first - lane * pitch;
}

export type MarkKind = 'bend' | 'harmonic' | 'palmMute';

/** What the planner reads of a slot: where it sits in the bar and the notes that start there. */
export interface MarkSlot {
  readonly offset: number;
  readonly notes: readonly NoteEvent[];
}

export interface MarkPlacement {
  readonly kind: MarkKind;
  /** The slot the mark belongs to; for a palm-mute run, its first slot. */
  readonly slot: number;
  /** The last slot of a palm-mute run; equals `slot` for other marks. */
  readonly lastSlot: number;
  /** The note a bend belongs to. */
  readonly note?: NoteEvent;
  readonly text: string;
  /** X range the mark claims within the bar, clearance included. */
  readonly left: number;
  readonly right: number;
  /** 0 is the lane nearest the staff. */
  readonly lane: number;
  /** For a bend, how far right of the slot the arrow starts, clear of any number stacked above its note. */
  readonly arrowOffset: number;
  /** X within the bar of the line that joins a raised mark to its note. */
  readonly stemX: number;
}

export interface MarkPlan {
  readonly marks: readonly MarkPlacement[];
  /** Set when a mark needed more lanes than the budget: widen the bar before this slot by at least `shortfall`. */
  readonly overflow?: { readonly slot: number; readonly shortfall: number };
}

interface Candidate {
  kind: MarkKind;
  slot: number;
  lastSlot: number;
  note?: NoteEvent;
  text: string;
  boxLeft: number;
  boxRight: number;
  /** Extra claimed span to the right that only blocks other marks, such as a dashed palm-mute line. */
  lineRight?: number;
  arrowOffset: number;
  stemX: number;
}

interface Taken {
  extentLeft: number;
  extentRight: number;
  boxLeft: number;
  boxRight: number;
  /** A line, not text: other marks keep clear of it, but a stem may cross it. */
  soft: boolean;
}

const markWidth = (text: string): number => labelBoxWidth(text, MARK_FONT_SIZE);

function candidates(slots: readonly MarkSlot[], fontSize: number): Candidate[] {
  const found: Candidate[] = [];
  slots.forEach((slot, si) => {
    for (const n of slot.notes) {
      const tech = n.techniques;
      if (tech.bend > 0) {
        const half = labelBoxWidth(fretLabel(n), fontSize) / 2;
        const above = slot.notes.filter((o) => o.string < n.string).map((o) => labelBoxWidth(fretLabel(o), fontSize) / 2);
        const arrowOffset = above.length ? Math.max(half * ARROW_LEAN, Math.max(...above) + 3) : half * ARROW_LEAN;
        const text = bendLabel(tech.bend);
        const centre = slot.offset + arrowOffset + ARROW_RUN;
        found.push({
          kind: 'bend',
          slot: si,
          lastSlot: si,
          note: n,
          text,
          boxLeft: centre - markWidth(text) / 2,
          boxRight: centre + markWidth(text) / 2,
          arrowOffset,
          stemX: centre,
        });
      }
      if (tech.harmonic) {
        const text = 'Harm.';
        found.push({
          kind: 'harmonic',
          slot: si,
          lastSlot: si,
          text,
          boxLeft: slot.offset - markWidth(text) / 2,
          boxRight: slot.offset + markWidth(text) / 2,
          arrowOffset: 0,
          stemX: slot.offset,
        });
      }
    }
  });

  const muted = slots.map((s) => s.notes.some((n) => n.techniques.palmMute));
  for (let i = 0; i < muted.length; i++) {
    if (!muted[i]) continue;
    let last = i;
    while (last + 1 < muted.length && muted[last + 1]) last++;
    const startX = slots[i].offset - PM_REACH_LEFT;
    const endX = slots[last].offset + PM_REACH_RIGHT;
    found.push({
      kind: 'palmMute',
      slot: i,
      lastSlot: last,
      text: PM_LABEL,
      boxLeft: startX,
      boxRight: startX + markWidth(PM_LABEL),
      lineRight: Math.max(endX, startX + PM_DASH_FROM),
      arrowOffset: 0,
      stemX: slots[i].offset,
    });
    i = last;
  }
  return found.sort((a, b) => a.boxLeft - b.boxLeft);
}

const overlapping = (a: { left: number; right: number }, b: { left: number; right: number }): boolean =>
  a.left < b.right && b.left < a.right;

/**
 * Gives each mark above the staff the lowest lane where it clears the marks already placed, and where the line that
 * rises from a raised bend to its label crosses no text in the lanes below. A bar that needs more lanes than the budget
 * reports the slot to widen before; the layout widens and plans again.
 */
export function planMarks(slots: readonly MarkSlot[], fontSize = 16): MarkPlan {
  const taken: Taken[][] = Array.from({ length: MAX_SEARCH_LANES }, () => []);
  const marks: MarkPlacement[] = [];
  let overflow: MarkPlan['overflow'];

  for (const c of candidates(slots, fontSize)) {
    const extent = { left: c.boxLeft - CLEARANCE, right: (c.lineRight ?? c.boxRight) + CLEARANCE };
    const textExtent = { left: extent.left, right: c.boxRight + CLEARANCE };
    const free = (lane: number) =>
      !taken[lane].some((t) => overlapping(extent, { left: t.extentLeft, right: t.extentRight }));
    // only a bend's arrow must not cross text; the thin leader of a harmonic or palm mute may pass through lower lanes
    const stemClear = (lane: number) =>
      c.kind !== 'bend' ||
      [...Array(lane).keys()].every(
        (below) =>
          !taken[below].some(
            (t) => !t.soft && overlapping({ left: c.stemX - STEM_HALF, right: c.stemX + STEM_HALF }, { left: t.boxLeft, right: t.boxRight }),
          ),
      );

    let lane = 0;
    while (lane < MAX_SEARCH_LANES - 1 && !(free(lane) && stemClear(lane))) lane++;

    if (lane >= LANE_BUDGET && !overflow) {
      const shifts = [...Array(LANE_BUDGET).keys()].map((l) => {
        const blockers = taken[l].filter((t) => overlapping(extent, { left: t.extentLeft, right: t.extentRight }));
        return Math.max(MIN_SHIFT, blockers.length ? Math.max(...blockers.map((t) => t.extentRight)) - extent.left : 0);
      });
      overflow = { slot: c.slot, shortfall: Math.min(...shifts) };
    }

    taken[lane].push({
      extentLeft: textExtent.left,
      extentRight: textExtent.right,
      boxLeft: c.boxLeft,
      boxRight: c.boxRight,
      soft: false,
    });
    if (c.lineRight !== undefined) {
      taken[lane].push({ extentLeft: c.boxRight, extentRight: extent.right, boxLeft: c.boxRight, boxRight: c.lineRight, soft: true });
    }
    marks.push({
      kind: c.kind,
      slot: c.slot,
      lastSlot: c.lastSlot,
      note: c.note,
      text: c.text,
      left: extent.left,
      right: extent.right,
      lane,
      arrowOffset: c.arrowOffset,
      stemX: c.stemX,
    });
  }
  return { marks, overflow };
}
