import type { MixState } from '../audio/mix-gains';
import type { AlignmentRecord, ProfileStore, RecordingProfile, RestoredProfile } from '../audio/recording-profile';

/** Quiet time after the last change before it is written, so dragging the slider is one save. */
export const DEBOUNCE_MS = 500;

/** The hash of a recording's bytes and its stored profile; either is null when unavailable. Never rejects (R20). */
export async function fetchProfile(
  hash: () => Promise<string>,
  store: ProfileStore,
): Promise<{ hash: string | null; profile: RecordingProfile | null }> {
  let key: string;
  try {
    key = await hash();
  } catch {
    return { hash: null, profile: null };
  }
  try {
    return { hash: key, profile: await store.load(key) };
  } catch {
    return { hash: key, profile: null };
  }
}

/** What a restore changes. Loop range and tempo are deliberately not here (R19). */
export interface RestorePlan {
  offset?: number;
  /** The saved alignment record, restored together with the offset it belongs to. */
  alignment?: AlignmentRecord;
  mix?: MixState;
}

/**
 * Which parts of a looked-up profile to apply (KTD12): only if the same recording is still the loaded one, and each
 * part only if the user has not changed it since the recording loaded. The mix is restored on the desktop only (R18).
 */
export function decideRestore(
  ctx: { stillLoaded: boolean; offsetMoved: boolean; mixMoved: boolean; desktop: boolean },
  profile: RestoredProfile | null,
): RestorePlan | null {
  if (!profile || !ctx.stillLoaded) return null;
  const plan: RestorePlan = {};
  if (!ctx.offsetMoved) {
    plan.offset = profile.offset;
    if (profile.alignment) plan.alignment = profile.alignment;
  }
  if (ctx.desktop && profile.mix && !ctx.mixMoved) plan.mix = profile.mix;
  return plan.offset === undefined && plan.mix === undefined ? null : plan;
}

export interface DebounceTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: never): void;
}

/** Coalesces rapid values into one call with the last; `flush` fires a pending value now, `cancel` drops it. */
export function createDebouncer<T>(ms: number, fire: (value: T) => void, timers: DebounceTimers = globalThis as unknown as DebounceTimers) {
  let timer: unknown;
  let pending: { value: T } | null = null;
  const clear = () => {
    if (timer !== undefined) timers.clearTimeout(timer as never);
    timer = undefined;
  };
  const flush = () => {
    clear();
    if (!pending) return;
    const { value } = pending;
    pending = null;
    fire(value);
  };
  return {
    push(value: T) {
      pending = { value };
      clear();
      timer = timers.setTimeout(flush, ms);
    },
    flush,
    cancel() {
      clear();
      pending = null;
    },
  };
}
