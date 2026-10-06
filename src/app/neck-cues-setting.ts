import { defaultProfileStorage, type ProfileStorage } from '../audio/profile-store-web';

/** Where the choice is kept in browser storage. */
export const NECK_CUES_KEY = 'tab-highway.neck-cues';

/** Whether the neck shows technique cues. On unless the player turned them off; anything unreadable counts as on. */
export function readNeckCues(storage: ProfileStorage | null = defaultProfileStorage()): boolean {
  try {
    return storage?.getItem(NECK_CUES_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Remembers the choice. A store that cannot be written to is skipped without a word: the switch still works for the session. */
export function writeNeckCues(on: boolean, storage: ProfileStorage | null = defaultProfileStorage()): void {
  try {
    storage?.setItem(NECK_CUES_KEY, on ? 'on' : 'off');
  } catch {
    // a blocked or full store only means the choice is not kept
  }
}
