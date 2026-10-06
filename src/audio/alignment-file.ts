import { AlignmentMap } from './alignment-map';
import { clampOffset } from './offset-range';
import { SECTION_NAME_MAX, type AlignmentRecord, type BarEvidence, type SectionRecord } from './recording-profile';

/** Bumped when the file's shape changes; a file with any other version reads as "no alignment". */
export const ALIGNMENT_FILE_VERSION = 1;

/** Most anchors a saved record may carry, well past any tab. */
const MAX_ANCHORS = 5000;
const MAX_SECTIONS = 64;
const MAX_SIGNATURE = 16;

/** One played bar in the file: the editable start, and what detection found. */
export interface AlignmentFileBar {
  bar: number;
  start: number;
  detected?: number;
  matched?: boolean;
  confidence?: number;
  tab?: string;
}

/**
 * A recording's alignment as it is written to disk, meant to be read and edited by hand. `bars` carries one entry per
 * played bar of the tab; `start` is the recording second the bar starts at, and the app reads edits to it on load.
 */
export interface AlignmentFile {
  version: number;
  /** The content hash of the recording this belongs to; a file for another recording is not used. */
  recording: string;
  source: AlignmentRecord['source'];
  tier?: 'lined-up' | 'roughly';
  revision?: number;
  fingerprint?: string;
  previousOffset?: number;
  attempt?: { revision: number; fingerprint: string };
  holds: { at: number; length: number }[];
  sections?: SectionRecord[];
  endAnchor?: number;
  bars?: AlignmentFileBar[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Sections that are whole numbers of bars, in order and not overlapping; anything else is no sections at all. */
function normalizeSections(raw: unknown): SectionRecord[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SECTIONS) return undefined;
  const sections: SectionRecord[] = [];
  let previousLast = -1;
  for (const s of raw) {
    if (!isRecord(s) || !Number.isInteger(s.firstBar) || !Number.isInteger(s.lastBar) || typeof s.letter !== 'string' || s.letter.length !== 1) return undefined;
    const firstBar = s.firstBar as number;
    const lastBar = s.lastBar as number;
    if (firstBar < 0 || lastBar < firstBar || firstBar <= previousLast) return undefined;
    previousLast = lastBar;
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    sections.push(name && name.length <= SECTION_NAME_MAX ? { firstBar, lastBar, letter: s.letter, name } : { firstBar, lastBar, letter: s.letter });
  }
  return sections;
}

function normalizeEvidence(entry: unknown): BarEvidence {
  const evidence: BarEvidence = {};
  if (!isRecord(entry)) return evidence;
  if (isNumber(entry.detected)) evidence.detected = entry.detected;
  if (typeof entry.tab === 'string' && entry.tab.length > 0 && entry.tab.length <= MAX_SIGNATURE) evidence.tab = entry.tab;
  if (isNumber(entry.confidence)) evidence.confidence = entry.confidence;
  if (typeof entry.matched === 'boolean') evidence.matched = entry.matched;
  return evidence;
}

/**
 * A trusted alignment record from untrusted data: the record's fields are optional and read with type checks, so a bad
 * one reads as absent and never costs the rest. The `bars` list gives the anchors and per-bar evidence; anchors need an
 * end anchor to count. Anything that is not an auto or manual record is no record at all.
 */
export function normalizeAlignmentRecord(raw: unknown): AlignmentRecord | undefined {
  if (!isRecord(raw) || (raw.source !== 'auto' && raw.source !== 'manual')) return undefined;
  const map = AlignmentMap.normalize({ base: 0, holds: raw.holds });
  if (!map) return undefined;
  const record: AlignmentRecord = { source: raw.source, holds: map.holds };
  const bars = Array.isArray(raw.bars) ? raw.bars : [];
  const anchored = bars.length > 0 && bars.length <= MAX_ANCHORS && bars.every((b) => isRecord(b) && isNumber(b.start)) && isNumber(raw.endAnchor);
  if (anchored) {
    record.anchors = bars.map((b) => (b as { start: number }).start);
    record.endAnchor = raw.endAnchor as number;
    const evidence = bars.map(normalizeEvidence);
    if (evidence.some((e) => Object.keys(e).length > 0)) record.evidence = evidence;
  }
  const sections = normalizeSections(raw.sections);
  if (sections) record.sections = sections;
  if (Number.isInteger(raw.revision) && (raw.revision as number) > 0) record.revision = raw.revision as number;
  if (typeof raw.fingerprint === 'string' && raw.fingerprint.length > 0 && raw.fingerprint.length <= 64) record.fingerprint = raw.fingerprint;
  if (raw.tier === 'lined-up' || raw.tier === 'roughly') record.tier = raw.tier;
  if (
    isRecord(raw.attempt) &&
    Number.isInteger(raw.attempt.revision) &&
    typeof raw.attempt.fingerprint === 'string' &&
    raw.attempt.fingerprint.length > 0 &&
    raw.attempt.fingerprint.length <= 64
  ) {
    record.attempt = { revision: raw.attempt.revision as number, fingerprint: raw.attempt.fingerprint };
  }
  if (isNumber(raw.previousOffset)) record.previousOffset = clampOffset(raw.previousOffset);
  return record;
}

/** The file for a recording's record: times rounded to the millisecond for reading, with one entry per bar. */
export function toAlignmentFile(recording: string, record: AlignmentRecord): AlignmentFile {
  const file: AlignmentFile = {
    version: ALIGNMENT_FILE_VERSION,
    recording,
    source: record.source,
    holds: record.holds.map((h) => ({ at: h.at, length: h.length })),
  };
  if (record.tier) file.tier = record.tier;
  if (record.revision !== undefined) file.revision = record.revision;
  if (record.fingerprint) file.fingerprint = record.fingerprint;
  if (record.previousOffset !== undefined) file.previousOffset = round(record.previousOffset, 3);
  if (record.attempt) file.attempt = { ...record.attempt };
  if (record.sections && record.sections.length > 0) file.sections = record.sections.map((s) => ({ ...s }));
  if (record.anchors && record.endAnchor !== undefined) {
    file.endAnchor = round(record.endAnchor, 3);
    file.bars = record.anchors.map((start, k) => {
      const e = record.evidence?.[k];
      const bar: AlignmentFileBar = { bar: k + 1, start: round(start, 3) };
      if (e?.detected !== undefined) bar.detected = round(e.detected, 3);
      if (e?.matched !== undefined) bar.matched = e.matched;
      if (e?.confidence !== undefined) bar.confidence = round(e.confidence, 2);
      if (e?.tab) bar.tab = e.tab;
      return bar;
    });
  }
  return file;
}

/** The record in a recording's file, or null when the file is not an alignment file for exactly this recording. */
export function parseAlignmentFile(raw: unknown, recording: string): AlignmentRecord | null {
  if (!isRecord(raw) || raw.version !== ALIGNMENT_FILE_VERSION || raw.recording !== recording) return null;
  return normalizeAlignmentRecord(raw) ?? null;
}
