import type { BarEvent } from '../model/score';

export const TICKS_PER_QUARTER = 960;
const MAX_FLAGS = 3;

export interface BeamInput {
  readonly tick: number;
  readonly durationTicks: number;
}

/** A beam over consecutive group members, `level` 2 or 3; a single member (`from === to`) gets a short stub. */
export interface BeamSegment {
  readonly level: number;
  readonly from: number;
  readonly to: number;
}

/** Notes joined by a first-level beam from the first member to the last, plus any deeper beams. */
export interface BeamGroup {
  /** Indexes into the input onsets, ascending. */
  readonly members: readonly number[];
  readonly segments: readonly BeamSegment[];
}

export interface BeamPlan {
  readonly groups: readonly BeamGroup[];
  /** Onsets with a flag but no beam partner. */
  readonly flagged: readonly number[];
}

/** Plain note values from a quarter down, then the scalings that give a dotted note and a triplet note. */
const NOTE_VALUES = [TICKS_PER_QUARTER, TICKS_PER_QUARTER / 2, TICKS_PER_QUARTER / 4, TICKS_PER_QUARTER / 8, TICKS_PER_QUARTER / 16];
const NOTE_SCALINGS = [1, 1.5, 2 / 3];
/** How close a duration must be to a note value, as a share of it, to count as that value. */
const VALUE_TOLERANCE = 0.02;

/** Plain note values from a whole note down; a dotted or triplet note is one of these scaled. */
const PLAIN_VALUES = [4, 2, 1, 0.5, 0.25, 0.125, 0.0625].map((q) => q * TICKS_PER_QUARTER);

function hasScaling(durationTicks: number, scaling: number): boolean {
  return PLAIN_VALUES.some((value) => Math.abs(durationTicks - value * scaling) <= value * scaling * VALUE_TOLERANCE);
}

/** True when the length is a plain note value scaled by 3/2, which prints with a dot. */
export function isDotted(durationTicks: number): boolean {
  return hasScaling(durationTicks, 1.5);
}

/** True when the length is a plain note value scaled by 2/3, which prints under a "3" bracket. */
export function isTriplet(durationTicks: number): boolean {
  return hasScaling(durationTicks, 2 / 3);
}

/**
 * Flags or beams a note of this length carries: none from a quarter up, one per halving below it. A dotted or triplet
 * note carries the flags of the plain note it is made from, so an eighth triplet has one flag, not two.
 */
export function flagCount(durationTicks: number): number {
  if (durationTicks >= TICKS_PER_QUARTER) return 0;
  for (let k = 0; k < NOTE_VALUES.length; k++) {
    for (const scaling of NOTE_SCALINGS) {
      const length = NOTE_VALUES[k] * scaling;
      if (Math.abs(durationTicks - length) <= length * VALUE_TOLERANCE) return Math.min(MAX_FLAGS, k);
    }
  }
  const halvings = Math.round(Math.log2(TICKS_PER_QUARTER / Math.max(1, durationTicks)));
  return Math.min(MAX_FLAGS, Math.max(1, halvings));
}

/** Ticks in one beat of the bar: the signature's denominator, or a dotted quarter in compound meters (6/8, 9/8, 12/8, 3/8). */
export function beatTicksFor(signature: BarEvent['timeSignature']): number {
  const { numerator, denominator } = signature;
  if (denominator === 8 && numerator % 3 === 0) return (TICKS_PER_QUARTER * 3) / 2;
  return (TICKS_PER_QUARTER * 4) / denominator;
}

/** Groups the onsets of one bar into beams per beat; a quarter note or longer ends a group. */
export function planBeams(onsets: readonly BeamInput[], barStartTick: number, signature: BarEvent['timeSignature']): BeamPlan {
  const beat = beatTicksFor(signature);
  const flags = onsets.map((o) => flagCount(o.durationTicks));
  const beatOf = (i: number) => Math.floor((onsets[i].tick - barStartTick) / beat);

  const runs: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i < onsets.length; i++) {
    if (flags[i] === 0) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    if (run.length && beatOf(run[run.length - 1]) !== beatOf(i)) {
      runs.push(run);
      run = [];
    }
    run.push(i);
  }
  if (run.length) runs.push(run);

  const groups: BeamGroup[] = [];
  const flagged: number[] = [];
  for (const members of runs) {
    if (members.length === 1) {
      flagged.push(members[0]);
      continue;
    }
    groups.push({ members, segments: deeperBeams(members, flags) });
  }
  return { groups, flagged };
}

function deeperBeams(members: readonly number[], flags: readonly number[]): BeamSegment[] {
  const segments: BeamSegment[] = [];
  for (let level = 2; level <= MAX_FLAGS; level++) {
    let start = -1;
    for (let m = 0; m <= members.length; m++) {
      const has = m < members.length && flags[members[m]] >= level;
      if (has && start < 0) start = m;
      if (!has && start >= 0) {
        segments.push({ level, from: start, to: m - 1 });
        start = -1;
      }
    }
  }
  return segments;
}
