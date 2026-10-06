import { AlignmentMap, type Hold } from '../audio/alignment-map';
import { NUDGE_COARSE_SECONDS, NUDGE_FINE_SECONDS, OFFSET_MAX_SECONDS } from '../audio/offset-range';
import type { Timeline } from '../model/score';
import type { AlignStatus } from './auto-align';
import type { NudgeSize } from './offset-controls';

/** The shortest a detected section may be nudged to; removing it is the way to delete one. */
export const SECTION_MIN_SECONDS = 0.1;

export interface SectionRow {
  /** Position in the map's holds, which edits take. */
  readonly index: number;
  readonly label: string;
}

/** Where a hold's bar line falls: the bar the tab waits after, by its number in the score, or a time when the line is not a known bar start. */
function labelOf(hold: Hold, timeline: Timeline): string {
  const length = hold.length.toFixed(1);
  const k = timeline.bars.findIndex((bar) => Math.abs(bar.startSeconds - hold.at) < 0.01);
  if (k > 0) return `Extra playing after bar ${timeline.bars[k - 1].scoreBar + 1}, ${length} s`;
  return `Extra playing at ${hold.at.toFixed(1)} s, ${length} s`;
}

export function describeSections(map: AlignmentMap, timeline: Timeline): SectionRow[] {
  return map.holds.map((hold, index) => ({ index, label: labelOf(hold, timeline) }));
}

/** Moves a section's length one nudge step, in the same steps as the offset, and never below the shortest allowed. */
export function nudgeSection(map: AlignmentMap, index: number, size: NudgeSize, direction: 1 | -1): AlignmentMap {
  const step = size === 'fine' ? NUDGE_FINE_SECONDS : NUDGE_COARSE_SECONDS;
  const next = Math.round((map.holds[index].length + direction * step) / NUDGE_FINE_SECONDS) * NUDGE_FINE_SECONDS;
  return map.withHoldLength(index, Math.max(SECTION_MIN_SECONDS, Number(next.toFixed(2))));
}

export function removeSection(map: AlignmentMap, index: number): AlignmentMap {
  return map.withoutHold(index);
}

/** The single manual offset: the base offset with every section gone. */
export function revertToManual(map: AlignmentMap): AlignmentMap {
  return AlignmentMap.fromOffset(map.base);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function notFoundText(reason: 'too-long' | 'silent' | 'not-confident' | 'out-of-range'): string {
  switch (reason) {
    case 'too-long':
      return 'This recording or tab is too long to line up automatically. Your offset is unchanged.';
    case 'silent':
      return 'The recording or the tab has no sound to compare, so it was not lined up. Your offset is unchanged.';
    case 'out-of-range':
      return `The recording starts more than ${OFFSET_MAX_SECONDS} seconds away from the tab, so it was not lined up. Your offset is unchanged.`;
    case 'not-confident':
      return 'Could not line the recording up with the tab. Your offset is unchanged.';
  }
}

/**
 * What the panel says about the detection, in the user's words. `sections` is how many sections the alignment has
 * now, so the count stays right after the user removes or nudges one.
 */
export function statusText(status: AlignStatus, sections?: number): string {
  switch (status.phase) {
    case 'idle':
      return '';
    case 'waiting':
      return "Waiting for the tab's sound to load before lining the recording up.";
    case 'analysing':
      return `Lining the recording up with the tab… ${Math.round(status.progress * 100)}%`;
    case 'found': {
      const count = sections ?? status.sections;
      const found =
        count === 0
          ? 'Lined up with the tab. No extra playing found.'
          : `Lined up with the tab. Found ${count} ${plural(count, 'section of extra playing', 'sections of extra playing')}.`;
      return status.skipped > 0
        ? `${found} The tab jumps past ${status.skipped} ${plural(status.skipped, 'stretch the recording skips', 'stretches the recording skips')}.`
        : found;
    }
    case 'not-found':
      return notFoundText(status.reason);
    case 'failed':
      return status.reason === 'no-sound'
        ? "Lining up needs the tab's sound, which could not be loaded. Your offset is unchanged."
        : 'Lining the recording up failed. Your offset is unchanged.';
    case 'discarded':
      return 'You moved the offset while the recording was being lined up, so the result was not applied. Use Re-analyse to apply it.';
    case 'manual':
      return 'Using the offset set by hand.';
  }
}
