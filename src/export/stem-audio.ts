import { decodeUserRecording, type PcmAudio } from './audio';
import { AUDIO_SAMPLE_RATE } from './presets';
import { stemGains, type MixState } from '../audio/mix-gains';
import { STEM_NAMES, type StemName } from '../stems/engine-client';

export type StemSources = Record<StemName, Blob>;

type Decode = (blob: Blob, offsetSeconds: number, durationSeconds: number) => Promise<PcmAudio>;

/**
 * Renders the current stem mix as export audio at the tab's original tempo. Stems are decoded one at a
 * time and summed into one buffer, so peak memory stays near one stem plus the sum. A stem with no gain
 * is not decoded at all, and a stem that cannot be decoded fails the whole export.
 */
export async function renderStemMix(
  sources: StemSources,
  mix: MixState,
  offsetSeconds: number,
  durationSeconds: number,
  decode: Decode = decodeUserRecording,
): Promise<PcmAudio> {
  const length = Math.ceil(durationSeconds * AUDIO_SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const gains = stemGains(mix);

  for (const name of STEM_NAMES) {
    const gain = gains[name];
    if (gain === 0) continue;
    let pcm: PcmAudio;
    try {
      pcm = await decode(sources[name], offsetSeconds, durationSeconds);
    } catch (e) {
      throw new Error(`The ${name} stem could not be read for the export${e instanceof Error ? `: ${e.message}` : '.'}`);
    }
    const n = Math.min(length, pcm.left.length, pcm.right.length);
    for (let i = 0; i < n; i++) {
      left[i] += pcm.left[i] * gain;
      right[i] += pcm.right[i] * gain;
    }
  }

  for (let i = 0; i < length; i++) {
    left[i] = Math.max(-1, Math.min(1, left[i]));
    right[i] = Math.max(-1, Math.min(1, right[i]));
  }
  return { left, right, sampleRate: AUDIO_SAMPLE_RATE };
}
