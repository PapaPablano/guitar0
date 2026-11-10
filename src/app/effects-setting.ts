import { defaultProfileStorage, type ProfileStorage } from '../audio/profile-store-web';

/** Where the choice is kept in browser storage. */
export const SYNTH_EFFECTS_KEY = 'tab-highway.synth-effects';

/** Whether the synth plays through its EQ and room. On unless the player turned it off; anything unreadable counts as on. */
export function readSynthEffects(storage: ProfileStorage | null = defaultProfileStorage()): boolean {
  try {
    return storage?.getItem(SYNTH_EFFECTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Remembers the choice. A store that cannot be written to is skipped without a word: the switch still works for the session. */
export function writeSynthEffects(on: boolean, storage: ProfileStorage | null = defaultProfileStorage()): void {
  try {
    storage?.setItem(SYNTH_EFFECTS_KEY, on ? 'on' : 'off');
  } catch {
    // a blocked or full store only means the choice is not kept
  }
}
