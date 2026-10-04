import { STEM_NAMES, type StemName } from '../stems/engine-client';

export interface StemMixState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export type MixState = Record<StemName, StemMixState>;

export function initialMix(): MixState {
  const mix = {} as MixState;
  for (const name of STEM_NAMES) mix[name] = { volume: 1, muted: false, solo: false };
  return mix;
}

/** A stem can be turned up to double its original level (+6 dB). 1 is the original level. */
export const MAX_STEM_VOLUME = 2;

const clampVolume = (v: number) => Math.min(MAX_STEM_VOLUME, Math.max(0, v));

/**
 * The gain each stem plays at. A stem is silent when muted, or when any stem is soloed and this one is
 * not; otherwise it plays at its volume.
 */
export function stemGains(mix: MixState): Record<StemName, number> {
  const anySolo = STEM_NAMES.some((name) => mix[name].solo);
  const gains = {} as Record<StemName, number>;
  for (const name of STEM_NAMES) {
    const s = mix[name];
    gains[name] = s.muted || (anySolo && !s.solo) ? 0 : clampVolume(s.volume);
  }
  return gains;
}
