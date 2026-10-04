import type { MixState } from './mix-gains';

/** The guitar amounts a fade-out schedule steps through, as a share of the base guitar volume; the last one holds. */
export const FADE_OUT_STEPS: readonly number[] = [1, 0.6, 0.25, 0];

/**
 * How the mix changes from one pass of a loop to the next. "fade-out" steps the guitar down; "listen-then-play"
 * alternates a pass with only the guitar (to hear the part) and a pass with the guitar muted (to play it).
 */
export type PassSchedule =
  | { readonly kind: 'off' }
  | { readonly kind: 'fade-out'; readonly steps: readonly number[] }
  | { readonly kind: 'listen-then-play' };

const clone = (mix: MixState): MixState => JSON.parse(JSON.stringify(mix)) as MixState;

/** The guitar's share of its base volume on a 1-based pass of a fade-out schedule; the last step holds. */
export function fadeStep(steps: readonly number[], pass: number): number {
  if (steps.length === 0) return 1;
  const index = Math.min(Math.max(1, Math.floor(pass)), steps.length) - 1;
  return Math.min(1, Math.max(0, steps[index]));
}

/**
 * The mix to play on a 1-based pass, applied on top of the user's base mix. A pure function: the base is
 * never changed, and an "off" schedule returns an equal copy of it.
 */
export function passMix(base: MixState, schedule: PassSchedule, pass: number): MixState {
  const next = clone(base);
  if (schedule.kind === 'fade-out') {
    next.guitar.volume = base.guitar.volume * fadeStep(schedule.steps, pass);
  } else if (schedule.kind === 'listen-then-play') {
    const listen = Math.floor(pass) % 2 === 1;
    for (const name of Object.keys(next) as (keyof MixState)[]) next[name].solo = false;
    if (listen) {
      next.guitar.solo = true;
      next.guitar.muted = false;
    } else {
      next.guitar.muted = true;
    }
  }
  return next;
}
