import type { AlignmentRecord } from '../audio/recording-profile';

/** A bar whose new start differs from the saved one by more than this (seconds) was placed somewhere else; detection's own grain is a hundredth. */
export const MOVED_SECONDS = 0.05;
/** A saved start that differs from the one detection chose by more than this was changed by hand; the file is written to the millisecond. */
export const EDITED_SECONDS = 0.0015;

/** What re-detecting changed against the saved alignment. */
export interface AlignmentDiff {
  /** Bars whose tab bar changed or is new, plus bars whose start moved to another place. */
  readonly repinned: number;
  /** Bars of the tab that no saved bar had the same signature for. */
  readonly tabBarsChanged: number;
  /** Bars the player had moved by hand whose saved place was not the one detection arrived at again. */
  readonly editsReplaced: number;
  /** Sections that keep the name the player gave them. */
  readonly sectionsKept: number;
}

/** The saved bars by the tab bar they were placed against, or null when the record does not say. */
function bySignature(record: AlignmentRecord): Map<string, number> | null {
  const evidence = record.evidence;
  if (!record.anchors || !evidence || evidence.length !== record.anchors.length || evidence.some((e) => !e.tab)) return null;
  return new Map(evidence.map((e, k) => [e.tab as string, k]));
}

/**
 * What changed between the alignment that was saved and the one just detected, or null when there is no saved timeline
 * to compare with, or nothing changed. Bars are matched by the tab bar they were placed against, so a tab edit that adds
 * or removes bars does not make every later bar look moved. A saved record that does not name its tab bars is matched
 * by position when the bar counts agree, and counts every bar as re-pinned otherwise.
 */
export function diffAlignments(previous: AlignmentRecord | null, next: AlignmentRecord): AlignmentDiff | null {
  if (!previous?.anchors || !next.anchors) return null;
  const savedAt = bySignature(previous);
  const nextTab = next.evidence?.map((e) => e.tab);
  const matchOf = (k: number): number | undefined => {
    if (savedAt && nextTab && nextTab[k]) return savedAt.get(nextTab[k] as string);
    return previous.anchors!.length === next.anchors!.length ? k : undefined;
  };

  let repinned = 0;
  let tabBarsChanged = 0;
  const matched = new Set<number>();
  next.anchors.forEach((start, k) => {
    const j = matchOf(k);
    if (j === undefined) {
      repinned += 1;
      tabBarsChanged += 1;
      return;
    }
    matched.add(j);
    if (Math.abs(previous.anchors![j] - start) > MOVED_SECONDS) repinned += 1;
  });

  let editsReplaced = 0;
  previous.anchors.forEach((saved, j) => {
    const detected = previous.evidence?.[j]?.detected;
    if (detected === undefined || Math.abs(saved - detected) <= EDITED_SECONDS) return;
    const survives = next.anchors!.some((start, k) => matchOf(k) === j && Math.abs(start - saved) <= MOVED_SECONDS);
    if (!survives) editsReplaced += 1;
  });

  const sectionsKept = next.sections?.filter((s) => s.name).length ?? 0;
  if (repinned === 0 && editsReplaced === 0) return null;
  return { repinned, tabBarsChanged, editsReplaced, sectionsKept };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The summary shown after re-detecting, such as "38 bars re-pinned, 2 of your edits replaced, 2 sections kept". */
export function describeDiff(diff: AlignmentDiff): string {
  const parts = [`${plural(diff.repinned, 'bar', 'bars')} re-pinned`];
  if (diff.editsReplaced > 0) parts.push(`${plural(diff.editsReplaced, 'edit of yours', 'of your edits')} replaced`);
  if (diff.sectionsKept > 0) parts.push(`${plural(diff.sectionsKept, 'section', 'sections')} kept`);
  return parts.join(', ');
}
