/**
 * Levels for the sound the tab plays through. The SoundFont's guitars are recorded at very different levels: played alone the
 * distorted ones come out about 13 dB under the bass and drums while the clean one is about 10 dB over them. Each guitar program
 * gets a gain that brings it to one common level, measured by rendering the same short riff through every program with
 * MuseScore General. A track's own volume in the file still applies on top.
 */
const TARGET_LEVEL = 0.06;
const MAX_GAIN = 4;
const MIN_GAIN = 0.3;

/** Measured RMS of the sample riff played alone through each guitar program (programs 24 to 31). */
const GUITAR_LEVELS: Readonly<Record<number, number>> = {
  24: 0.0475, // nylon
  25: 0.0205, // steel
  26: 0.0233, // jazz
  27: 0.1875, // clean
  28: 0.0855, // muted
  29: 0.0164, // overdrive
  30: 0.0185, // distortion
  31: 0.0243, // harmonics
};

/** The gain that evens out a program's level; 1 for every sound that is not tuned. */
export function programGain(program: number): number {
  const level = GUITAR_LEVELS[program];
  if (level === undefined) return 1;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_LEVEL / level));
}
