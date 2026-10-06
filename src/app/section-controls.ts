import type { Section } from '../alignment/sections';
import { SECTION_NAME_MAX, type SectionRecord } from '../audio/recording-profile';
import type { Timeline } from '../model/score';
import type { LoopBars } from '../render/tab-strip';

/** Least standard score of a bar's onset peak for the bar to count as pinned down; the matcher's own cutoff. */
const PINNED_PEAK = 3;

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
  /** How far the latest jump into the section landed from its anchor, or nothing before the first jump. */
  readonly landing: string;
}

/**
 * How far to trust a section's alignment, in words: not matched when most of its bars were played differently from
 * the tab, uncertain when some were or when a bar's onsets did not pin its anchor down, confident otherwise.
 */
export function readoutOf(section: SectionRecord, health: BarHealth): Readout {
  const { barConfidence, barMatched } = health;
  if (barMatched.length === 0 || barConfidence.length === 0) return 'not measured';
  let matched = 0;
  let pinned = 0;
  const bars = section.lastBar - section.firstBar + 1;
  for (let k = section.firstBar; k <= section.lastBar; k++) {
    if (barMatched[k]) matched += 1;
    if ((barConfidence[k] ?? 0) >= PINNED_PEAK) pinned += 1;
  }
  if (matched / bars < 0.5) return 'not matched';
  return matched < bars || pinned < bars ? 'uncertain' : 'confident';
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
