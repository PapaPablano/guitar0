import type { BankSource } from './synth-bridge';
// Bank files are tracked assets; Vite gives each a content-hashed name, so a new file is never served from an old cache.
import museScoreGeneralUrl from '../../assets/soundfont/MuseScore_General.sf3?url';

/** One sound bank that ships with the app. */
export interface BundledBank {
  /** A stable name for the bank, independent of the hashed file name. */
  id: string;
  /** Where the built app serves the file. */
  url: string;
}

/**
 * The bundled banks in layering order. MuseScore General comes first and covers every General MIDI sound; each later bank
 * is added over it, so its presets win for the programs it covers.
 */
export const BUNDLED_BANKS: readonly BundledBank[] = [{ id: 'musescore-general', url: museScoreGeneralUrl }];

/** The bundled banks as synth sources, in layering order. */
export function bundledBankSources(): BankSource[] {
  return BUNDLED_BANKS.map((bank) => ({ url: bank.url }));
}

/** Every current bundled bank URL; cached entries outside this list are an older build's. */
export function bundledBankUrls(): string[] {
  return BUNDLED_BANKS.map((bank) => bank.url);
}
