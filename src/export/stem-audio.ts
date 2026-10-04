import { decodeUserRecording, type PcmAudio, type RecordingPlacement } from './audio';
import { clampOffset } from '../audio/offset-range';
import { AUDIO_SAMPLE_RATE } from './presets';
import { stemGains, type MixState } from '../audio/mix-gains';
import { STEM_NAMES, type StemName } from '../stems/engine-client';

export type StemSources = Record<StemName, Blob>;

type Decode = (blob: Blob, offsetSeconds: number, durationSeconds: number) => Promise<PcmAudio>;

/**
 * Renders the current stem mix as export audio at the tab's original tempo. Stems are decoded one at a
 * time and summed into one buffer, so peak memory stays near one stem plus the sum. A stem with no gain
 * is not decoded at all, the signed offset goes to the decoder unchanged (negative delays the stems), and a stem that cannot be decoded fails the whole export.
 */
export function renderStemMix(
  sources: StemSources,
  mix: MixState,
  offsetSeconds: number,
  durationSeconds: number,
  decode: Decode = decodeUserRecording,
): Promise<PcmAudio> {
  return sumStems(sources, mix, durationSeconds, (blob) => decode(blob, offsetSeconds, durationSeconds));
}

/**
 * Where the recording sits in an output window that starts at `startSeconds` of the tab: the recording
 * position is the tab time plus the offset, so output time `u` plays recording time `start + u + offset`.
 */
export function windowPlacement(offsetSeconds: number, startSeconds: number, durationSeconds: number): RecordingPlacement {
  const position = startSeconds + clampOffset(offsetSeconds);
  const delaySeconds = Math.max(0, -position);
  return { delaySeconds, startSeconds: Math.max(0, position), audible: delaySeconds < durationSeconds };
}

type DecodeWindow = (blob: Blob, offsetSeconds: number, startSeconds: number, durationSeconds: number) => Promise<PcmAudio>;

/** Decodes a recording and places only the window `[start, start + duration)` of the tab's timeline. */
export async function decodeRecordingWindow(
  file: Blob,
  offsetSeconds: number,
  startSeconds: number,
  durationSeconds: number,
): Promise<PcmAudio> {
  const bytes = await file.arrayBuffer();
  const length = Math.ceil(durationSeconds * AUDIO_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, length, AUDIO_SAMPLE_RATE);
  const decoded = await offline.decodeAudioData(bytes);
  const placement = windowPlacement(offsetSeconds, startSeconds, durationSeconds);
  if (placement.audible) {
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(placement.delaySeconds, placement.startSeconds);
  }
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  return { left: new Float32Array(left), right: new Float32Array(right), sampleRate: AUDIO_SAMPLE_RATE };
}

/** Like `renderStemMix`, but renders only a span of the tab (a loop or bar range). */
export function renderStemMixRange(
  sources: StemSources,
  mix: MixState,
  offsetSeconds: number,
  range: { startSeconds: number; durationSeconds: number },
  decode: DecodeWindow = decodeRecordingWindow,
): Promise<PcmAudio> {
  return sumStems(sources, mix, range.durationSeconds, (blob) =>
    decode(blob, offsetSeconds, range.startSeconds, range.durationSeconds),
  );
}

async function sumStems(
  sources: StemSources,
  mix: MixState,
  durationSeconds: number,
  decodeStem: (blob: Blob) => Promise<PcmAudio>,
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
      pcm = await decodeStem(sources[name]);
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
