// Telling the app what tuning a file's tab is really written for. Some files say standard but are
// meant for a guitar tuned down; the fret numbers are right and the open strings are not. This keeps
// every fret as written and changes the open-string pitches, so the sound and note names follow.
// (Showing the same sound with moved frets is retune.ts; this is the opposite, and it edits the score.)

import type * as alphaTab from '@coderline/alphatab';

/** Each track's staves' open-string pitches as the file wrote them: original[track][staff]. */
export type WrittenTunings = readonly (readonly (readonly number[])[])[];

export function captureTunings(score: alphaTab.model.Score): WrittenTunings {
  return score.tracks.map((track) => track.staves.map((staff) => [...staff.tuning]));
}

function setTuning(staff: alphaTab.model.Staff, values: readonly number[]): void {
  const open = staff.tuning;
  values.forEach((midi, i) => {
    open[i] = midi;
  });
}

/**
 * Sets the tuning the file is really in, always starting from the tuning it was written with, so
 * repeated choices never add up. A new tuning that moves every string by the same amount (half step
 * down, full step down) is applied to every pitched track, since the whole song is in that key. Any
 * other tuning (Drop D, open tunings) applies to the chosen track only. `null` restores the file as
 * written. A tuning with a different string count than the chosen track is ignored.
 */
export function applyFileTuning(
  score: alphaTab.model.Score,
  written: WrittenTunings,
  trackIndex: number,
  tuning: readonly number[] | null,
): void {
  score.tracks.forEach((track, t) => {
    track.staves.forEach((staff, s) => {
      const own = written[t]?.[s];
      if (own && own.length > 0) setTuning(staff, own);
    });
  });
  const chosen = written[trackIndex]?.[0];
  if (!tuning || !chosen || chosen.length !== tuning.length) return;

  const shifts = tuning.map((midi, i) => midi - chosen[i]);
  const uniform = shifts.every((d) => d === shifts[0]);
  score.tracks.forEach((track, t) => {
    if (track.isPercussion) return;
    track.staves.forEach((staff, s) => {
      const own = written[t]?.[s];
      if (!own || own.length === 0) return;
      if (t === trackIndex && own.length === tuning.length) setTuning(staff, tuning);
      else if (uniform && t !== trackIndex) setTuning(staff, own.map((m) => m + shifts[0]));
    });
  });
}
