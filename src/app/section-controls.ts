import type { Section } from '../alignment/sections';
import { PINNED_PEAK } from '../alignment/spot-check';
import { SECTION_NAME_MAX, type SectionRecord } from '../audio/recording-profile';
import type { Timeline } from '../model/score';
import type { LoopBars } from '../render/tab-strip';

/** The share of a section's bars that must match the tab for the section to read as confident. */
const CONFIDENT_MATCHED = 0.9;
/** Below this share the section was mostly played differently from the tab. */
const NOT_MATCHED_BELOW = 0.5;

/** How well the warm-up matched each bar, as the matcher reported it. Empty when it was not measured this session. */
export interface BarHealth {
  readonly barConfidence: readonly number[];
  readonly barMatched: readonly boolean[];
}

export type Readout = 'confident' | 'uncertain' | 'not matched' | 'not measured';

export interface SectionRow {
  readonly index: number;
  readonly label: string;
  /** The letter by repetition, shown beside a name the user gave. */
  readonly letter: string;
  /** The bar numbers as the tab shows them. */
  readonly bars: string;
  readonly readout: Readout;
  /** How finely the bars were placed, such as "17 of 23 bars confirmed by onsets, the rest settled from the whole song". */
  readonly precision: string;
  /** How far the latest jump into the section landed from its anchor, or nothing before the first jump. */
  readonly landing: string;
}

/** How many of a section's bars matched the tab and how many were also placed to the beat by their onsets. */
function countBars(section: SectionRecord, health: BarHealth): { bars: number; matched: number; pinned: number } {
  let matched = 0;
  let pinned = 0;
  const bars = section.lastBar - section.firstBar + 1;
  for (let k = section.firstBar; k <= section.lastBar; k++) {
    if (health.barMatched[k]) matched += 1;
    if ((health.barConfidence[k] ?? 0) >= PINNED_PEAK) pinned += 1;
  }
  return { bars, matched, pinned };
}

/**
 * Whether the recording plays what the tab says, in words: not matched when most of the section's bars were played
 * differently from the tab, uncertain when a good share were, confident otherwise. How finely each bar was placed is a
 * separate matter (`precisionOf`): most bars of loud, dense music are matched surely but have no onset of their own to confirm them, and take their place from the whole song.
 */
export function readoutOf(section: SectionRecord, health: BarHealth): Readout {
  if (health.barMatched.length === 0 || health.barConfidence.length === 0) return 'not measured';
  const { bars, matched } = countBars(section, health);
  if (matched / bars < NOT_MATCHED_BELOW) return 'not matched';
  return matched / bars < CONFIDENT_MATCHED ? 'uncertain' : 'confident';
}

/** How finely the section's bars were placed; empty when nothing was measured. */
export function precisionOf(section: SectionRecord, health: BarHealth): string {
  if (health.barMatched.length === 0 || health.barConfidence.length === 0) return '';
  const { bars, pinned } = countBars(section, health);
  const noun = bars === 1 ? 'bar' : 'bars';
  if (pinned === bars) return `all ${bars} ${noun} confirmed by onsets`;
  if (pinned === 0) return `${bars} ${noun} settled from the whole song`;
  return `${pinned} of ${bars} ${noun} confirmed by onsets, the rest settled from the whole song`;
}

export function landingText(errorSeconds: number): string {
  return `last landing ${Math.round(errorSeconds * 1000)} ms`;
}

/** The rows of the section list. A single section that spans the whole song reads "Whole song". */
export function describeSectionRows(
  sections: readonly SectionRecord[],
  timeline: Timeline,
  health: BarHealth,
  landings: Readonly<Record<number, number>>,
): SectionRow[] {
  const barCount = timeline.bars.length;
  return sections.map((s, index) => {
    const wholeSong = sections.length === 1 && s.firstBar === 0 && s.lastBar === barCount - 1;
    const first = (timeline.bars[s.firstBar]?.scoreBar ?? s.firstBar) + 1;
    const last = (timeline.bars[s.lastBar]?.scoreBar ?? s.lastBar) + 1;
    return {
      index,
      label: wholeSong ? 'Whole song' : (s.name ?? `Section ${s.letter}`),
      letter: s.letter,
      bars: `bars ${first} to ${last}`,
      readout: readoutOf(s, health),
      precision: precisionOf(s, health),
      landing: landings[index] === undefined ? '' : landingText(landings[index]),
    };
  });
}

/** Where a jump to the section goes: the start of its first bar, in tab seconds. */
export function jumpTarget(section: SectionRecord, timeline: Timeline): number {
  return timeline.bars[section.firstBar]?.startSeconds ?? 0;
}

/** The bar loop that covers the section, in the tab's own bar numbers. */
export function loopFor(section: SectionRecord, timeline: Timeline): LoopBars {
  return {
    startBar: timeline.bars[section.firstBar]?.scoreBar ?? section.firstBar,
    endBar: timeline.bars[section.lastBar]?.scoreBar ?? section.lastBar,
  };
}

/** The index of the section that holds a played bar, or -1. */
export function sectionIndexAt(sections: readonly SectionRecord[], bar: number): number {
  return sections.findIndex((s) => bar >= s.firstBar && bar <= s.lastBar);
}

/** A copy with one section's name set; an empty name takes the name away, and a long one is cut. */
export function renameSection(sections: readonly SectionRecord[], index: number, name: string): SectionRecord[] {
  const trimmed = name.trim().slice(0, SECTION_NAME_MAX);
  return sections.map((s, i) => {
    if (i !== index) return s;
    const { name: _old, ...rest } = s;
    return trimmed ? { ...rest, name: trimmed } : rest;
  });
}

/** Found sections with the names the user gave carried over from sections over exactly the same bars. */
export function carryNames(previous: readonly SectionRecord[], found: readonly Section[]): SectionRecord[] {
  return found.map((s) => {
    const same = previous.find((p) => p.firstBar === s.firstBar && p.lastBar === s.lastBar && p.name);
    return same?.name ? { ...s, name: same.name } : { ...s };
  });
}
