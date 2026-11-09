/**
 * Setting bar 1 to the recording's first sound. The match can put bar 1 a beat or more before the recording begins when a
 * repeating pattern looks nearly as good a beat early; the tab then runs alone first. This applies only when the recording and
 * the tab both begin sounding at once, so a recording with an intro the tab lacks is left as matched.
 */

export const START_CHECK = {
  /** Bar 1 must be before the start of the recording by more than this, in seconds, for the check to apply. */
  marginSeconds: 0.15,
  /** The recording must sound within this many seconds of its start. */
  recordingFirstSoundMax: 1,
  /** The tab's render must sound within this many seconds of its start. */
  tabFirstSoundMax: 0.5,
} as const;

/**
 * Whether the check applies: bar 1 is before the recording by more than the margin but less than a bar, and recording and tab
 * both begin sounding at once. A recording that really starts a bar or more into the tab looks the same, so it is left as matched.
 */
export function startCheckApplies(barOneAnchor: number, recordingFirstSound: number | null, tabFirstSound: number | null, barSeconds: number): boolean {
  return (
    barOneAnchor < -START_CHECK.marginSeconds &&
    -barOneAnchor < barSeconds &&
    recordingFirstSound !== null &&
    recordingFirstSound <= START_CHECK.recordingFirstSoundMax &&
    tabFirstSound !== null &&
    tabFirstSound <= START_CHECK.tabFirstSoundMax
  );
}

/** Where bar 1 would sit if the recording's first sound were the tab's first sound: both measured from their own starts. */
export function startGuess(barOneStart: number, recordingFirstSound: number, tabFirstSound: number): number {
  return barOneStart + recordingFirstSound - tabFirstSound;
}

/** Every anchor and the end anchor moved by one constant, so spacings, holds and sections stay as matched. */
export function shiftTimeline(anchors: readonly number[], endAnchor: number, delta: number): { anchors: number[]; endAnchor: number } {
  return { anchors: anchors.map((a) => a + delta), endAnchor: endAnchor + delta };
}

/**
 * Whether to keep the shifted timeline: it passes the consistency check, and bar 1's onsets support it at least as well as at
 * the old place or clearly enough on their own (`floor`, the matcher's own bar of "convincing").
 */
export function acceptShift(passesCheck: boolean, oldProminence: number, newProminence: number, floor: number): boolean {
  return passesCheck && (newProminence >= oldProminence || newProminence >= floor);
}

export interface StartCorrectionInput {
  readonly anchors: readonly number[];
  readonly endAnchor: number;
  readonly barOneStart: number;
  /** The length of bar 1 in the tab, in seconds. */
  readonly barSeconds: number;
  readonly recordingFirstSound: number | null;
  readonly tabFirstSound: number | null;
  /** Sharpens bar 1's position on the onsets around a guess. */
  readonly refine: (guess: number) => { seconds: number; prominence: number };
  /** The consistency check, on a whole timeline. */
  readonly passesCheck: (anchors: readonly number[], endAnchor: number) => boolean;
  readonly floor: number;
}

/** The timeline with bar 1 set to the recording's first sound, or null when the check does not apply or the result does not hold. */
export function proposeStartCorrection(i: StartCorrectionInput): { anchors: number[]; endAnchor: number } | null {
  if (!startCheckApplies(i.anchors[0], i.recordingFirstSound, i.tabFirstSound, i.barSeconds)) return null;
  const guess = startGuess(i.barOneStart, i.recordingFirstSound!, i.tabFirstSound!);
  const at = i.refine(guess);
  const before = i.refine(i.anchors[0]);
  const shifted = shiftTimeline(i.anchors, i.endAnchor, (at.prominence > 0 ? at.seconds : guess) - i.anchors[0]);
  return acceptShift(i.passesCheck(shifted.anchors, shifted.endAnchor), before.prominence, at.prominence, i.floor) ? shifted : null;
}
