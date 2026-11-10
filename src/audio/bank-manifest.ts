import type { BankSource } from './synth-bridge';
import type { LevelTable } from './track-balance';
// Bank files are tracked assets; Vite gives each a content-hashed name, so a new file is never served from an old cache.
import museScoreGeneralUrl from '../../assets/soundfont/MuseScore_General.sf3?url';

/** One sound bank that ships with the app. */
export interface BundledBank {
  /** A stable name for the bank, independent of the hashed file name. */
  id: string;
  /** Where the built app serves the file. */
  url: string;
  /** The reference riff's RMS through each guitar and bass program this bank covers (see `bank-levels.ts`). */
  levels: LevelTable;
}

/**
 * MuseScore General's levels. Guitars 24 to 31 keep the numbers the gains were first tuned with; today's reference riff
 * lands within 2 dB of each (the palm-muted 28 is the farthest, about 1.5 dB louder). Bass 32 to 34 were measured with
 * `dev/measure-bank-levels.ts`.
 */
const MUSESCORE_GENERAL_LEVELS: LevelTable = {
  24: 0.0475, // nylon
  25: 0.0205, // steel
  26: 0.0233, // jazz
  27: 0.1875, // clean
  28: 0.0855, // muted
  29: 0.0164, // overdrive
  30: 0.0185, // distortion
  31: 0.0243, // harmonics
  32: 0.1543, // acoustic bass
  33: 0.1338, // fingered bass
  34: 0.1204, // picked bass
};

/**
 * The bundled banks in layering order. MuseScore General comes first and covers every General MIDI sound; each later bank
 * is added over it, so its presets win for the programs it covers.
 */
export const BUNDLED_BANKS: readonly BundledBank[] = [
  { id: 'musescore-general', url: museScoreGeneralUrl, levels: MUSESCORE_GENERAL_LEVELS },
];

/**
 * The bank a player's own bank moves its palm-mute presets to (KTD2). No bundled bank has muted candidates, so no bundled
 * file reserves one; a bundled bank that gains some must pick a different number.
 */
export const PLAYER_RESERVED_BANK = 300;

/** The bundled banks as synth sources, in layering order. */
export function bundledBankSources(): BankSource[] {
  return BUNDLED_BANKS.map((bank) => ({ url: bank.url }));
}

/** Every current bundled bank URL; cached entries outside this list are an older build's. */
export function bundledBankUrls(): string[] {
  return BUNDLED_BANKS.map((bank) => bank.url);
}
