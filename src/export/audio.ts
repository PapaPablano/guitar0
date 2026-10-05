import type { AlignmentMap } from '../audio/alignment-map';
import { clampOffset } from '../audio/offset-range';
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
 * How long an export is: the tab plus every stretch of extra playing, since the tab waits through those while
 * the recording plays on. Without an alignment it is the tab's length.
 */
export function exportLength(durationSeconds: number, alignment?: AlignmentMap | null): number {
  return durationSeconds + (alignment?.totalHold ?? 0);
}

/**
 * The tab time a video frame shows at `outputSeconds` into the export. The recording is placed straight from its
 * base offset, so output time is the recording position less that offset; with no holds it is the tab time itself.
 */
export function tabTimeAt(alignment: AlignmentMap | null | undefined, outputSeconds: number): number {
  if (!alignment || alignment.holds.length === 0) return outputSeconds;
  return Math.max(0, alignment.toTab(outputSeconds + alignment.base));
}

/**
 * A span of the tab (a loop) as a span of the export's output time. It starts where the tab rejoins at its
 * first bar and ends where the tab arrives at its last, so extra playing inside the loop is included.
 */
export function outputWindow(
  alignment: AlignmentMap | null | undefined,
  range: { readonly startSeconds: number; readonly endSeconds: number },
): { startSeconds: number; endSeconds: number } {
  if (!alignment || alignment.holds.length === 0) return { startSeconds: range.startSeconds, endSeconds: range.endSeconds };
  return {
    startSeconds: alignment.toRec(range.startSeconds, 'start') - alignment.base,
    endSeconds: alignment.toRec(range.endSeconds, 'end') - alignment.base,
  };
}

/** Where the recording sits on the tab's timeline. */
export interface RecordingPlacement {
  /** Silence at the start of the output before the recording begins. */
  readonly delaySeconds: number;
  /** The position in the recording it starts from. */
  readonly startSeconds: number;
  /** False when the delay reaches the end of the tab, so nothing of the recording is heard. */
  readonly audible: boolean;
}

/**
 * Turns a signed offset into a placement. The recording position is the tab time plus the offset:
 * a negative offset delays the recording (silence first), a positive one skips its start.
 */
export function placeRecording(offsetSeconds: number, durationSeconds: number): RecordingPlacement {
  const offset = clampOffset(offsetSeconds);
  const delaySeconds = Math.max(0, -offset);
  return { delaySeconds, startSeconds: Math.max(0, offset), audible: delaySeconds < durationSeconds };
}

/**
 * Decodes the user's recording and places it on the tab's timeline (see `placeRecording`). The output
 * is always the tab's length; a recording that runs past the end is cut. The result is the whole song
 * at its original tempo.
 */
export async function decodeUserRecording(file: Blob, offsetSeconds: number, durationSeconds: number): Promise<PcmAudio> {
  const bytes = await file.arrayBuffer();
  const length = Math.ceil(durationSeconds * AUDIO_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, length, AUDIO_SAMPLE_RATE);
  const decoded = await offline.decodeAudioData(bytes);
  const placement = placeRecording(offsetSeconds, durationSeconds);
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
