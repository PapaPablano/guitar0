/**
 * Levels for the sound the tab plays through. Banks record their guitars and basses at very different levels: in MuseScore
 * General, played alone, the distorted guitars come out about 13 dB under the bass and drums while the clean one is about
 * 10 dB over them. Each guitar and bass program gets a gain that brings it to one common level per family, from the RMS of
 * the same short riff played through that program (`bank-levels.ts`). Every active bank supplies a table of those levels;
 * a track's own volume in the file still applies on top.
 */
import { BUNDLED_BANKS } from './bank-manifest';

/** Measured RMS of the reference riff played alone through each program a bank covers, by program number. */
export type LevelTable = Readonly<Record<number, number>>;

/** The level every guitar program (24 to 31) is brought to. */
const TARGET_LEVEL = 0.06;
/**
 * The level every bass program (32 to 34) is brought to: MuseScore General's fingered bass, as measured. Bass was not levelled
 * before, and the guitars' target was set against it, so its level stays where the band already sits.
 */
const BASS_TARGET_LEVEL = 0.1338;
const MAX_GAIN = 4;
const MIN_GAIN = 0.3;

function targetFor(program: number): number | undefined {
  if (program >= 24 && program <= 31) return TARGET_LEVEL;
  if (program >= 32 && program <= 34) return BASS_TARGET_LEVEL;
  return undefined;
}

const usable = (level: number | undefined): level is number => level !== undefined && Number.isFinite(level) && level > 0;

/**
 * One table from the active banks' tables, given in layering order: a later bank's level wins for every program it lists,
 * matching how the synth takes a program's sound from the last bank that covers it. A silent or broken level is skipped.
 */
export function mergeLevels(tables: readonly LevelTable[]): LevelTable {
  const merged: Record<number, number> = {};
  for (const table of tables) {
    for (const [program, level] of Object.entries(table)) if (usable(level)) merged[Number(program)] = level;
  }
  return merged;
}

let active: LevelTable = mergeLevels(BUNDLED_BANKS.map((bank) => bank.levels));

/** The level table the synth's gains currently come from. */
export function activeLevels(): LevelTable {
  return active;
}

/** Sets the active banks' level tables, in layering order. Gains already applied to a playing synth change on its next ready. */
export function setActiveLevels(tables: readonly LevelTable[]): void {
  active = mergeLevels(tables);
}

/** The gain that evens out a program's level; 1 for every sound that is not levelled or has no level in the table. */
export function programGain(program: number, levels: LevelTable = active): number {
  const target = targetFor(program);
  const level = levels[program];
  if (target === undefined || !usable(level)) return 1;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, target / level));
}
