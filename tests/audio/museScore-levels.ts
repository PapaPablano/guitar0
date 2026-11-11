import { afterEach, beforeEach } from 'vitest';
import { BUNDLED_BANKS } from '../../src/audio/bank-manifest';
import { setActiveLevels } from '../../src/audio/track-balance';

/** MuseScore General's own level table, without the FreePats banks layered over it. */
export const museScoreLevels = () => BUNDLED_BANKS.find((bank) => bank.id === 'musescore-general')!.levels;

/**
 * Runs each test in the calling file with only MuseScore General's levels active, so tests about silencing, tones and
 * gains keep the numbers they were written against (MuseScore General's bass gains are exactly 1). Restores the bundled
 * levels afterwards.
 */
export function useMuseScoreLevelsOnly(): void {
  beforeEach(() => setActiveLevels([museScoreLevels()]));
  afterEach(() => setActiveLevels(BUNDLED_BANKS.map((bank) => bank.levels)));
}
