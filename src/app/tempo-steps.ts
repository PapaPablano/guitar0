/** The tempo choices, in percent: 25, 50, 75, 100 and 125. All are speeds the embedded YouTube player offers, so the video can always follow. */
export const TEMPO_MIN = 25;
export const TEMPO_MAX = 125;
export const TEMPO_STEP = 25;

/** The next tempo up (+1) or down (-1) from `percent`, stopping at the ends. */
export function stepTempo(percent: number, direction: 1 | -1): number {
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, percent + direction * TEMPO_STEP));
}
