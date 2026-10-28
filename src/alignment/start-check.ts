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

/** Whether the check applies: bar 1 is before the recording, and recording and tab both begin sounding at once. */
export function startCheckApplies(barOneAnchor: number, recordingFirstSound: number | null, tabFirstSound: number | null): boolean {
  return (
    barOneAnchor < -START_CHECK.marginSeconds &&
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

/** Whether to keep the shifted timeline: it passes the consistency check and bar 1's onsets support it at least as well as before. */
export function acceptShift(passesCheck: boolean, oldProminence: number, newProminence: number): boolean {
  return passesCheck && newProminence >= oldProminence;
}
