import { AUDIO_SAMPLE_RATE } from './presets';

/** Stereo audio as two planar channels, ready for the encoder. */
export interface PcmAudio {
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
}

/** Splits interleaved stereo samples (L R L R ...) into planar channels. */
export function deinterleave(samples: Float32Array): { left: Float32Array; right: Float32Array } {
  const frames = Math.floor(samples.length / 2);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = samples[i * 2];
    right[i] = samples[i * 2 + 1];
  }
  return { left, right };
}

/** Joins chunks of planar audio end to end. */
export function concatPcm(chunks: readonly { left: Float32Array; right: Float32Array }[], sampleRate: number): PcmAudio {
  const total = chunks.reduce((sum, c) => sum + c.left.length, 0);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    left.set(c.left, at);
    right.set(c.right, at);
    at += c.left.length;
  }
  return { left, right, sampleRate };
}

/** Pads with silence or truncates so the audio lasts exactly as long as the video. */
export function fitPcm(pcm: PcmAudio, durationSeconds: number): PcmAudio {
  const target = Math.ceil(durationSeconds * pcm.sampleRate);
  if (pcm.left.length === target) return pcm;
  const left = new Float32Array(target);
  const right = new Float32Array(target);
  const copy = Math.min(target, pcm.left.length);
  left.set(pcm.left.subarray(0, copy));
  right.set(pcm.right.subarray(0, copy));
  return { left, right, sampleRate: pcm.sampleRate };
}

/**
 * Decodes the user's recording and places it on the tab's timeline: the recording position is the
 * tab time plus `offsetSeconds`, so the offset skips that much of its start. The offset is never
 * negative. The result is the whole song at its original tempo.
 */
export async function decodeUserRecording(file: File, offsetSeconds: number, durationSeconds: number): Promise<PcmAudio> {
  const bytes = await file.arrayBuffer();
  const length = Math.ceil(durationSeconds * AUDIO_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, length, AUDIO_SAMPLE_RATE);
  const decoded = await offline.decodeAudioData(bytes);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, Math.max(0, offsetSeconds));
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  return { left: new Float32Array(left), right: new Float32Array(right), sampleRate: AUDIO_SAMPLE_RATE };
}
