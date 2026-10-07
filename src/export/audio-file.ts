import type { PcmAudio } from './audio';

/** A span of the tab's timeline, in seconds. */
export interface TimeRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export type AudioExportPlan =
  | { readonly ok: true; readonly startSeconds: number; readonly durationSeconds: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Decides what an audio export renders. With no range it is the whole song; with a range it is just
 * that span (clipped to the song's end). There is no length limit. An empty range or one outside the song
 * is refused with a message.
 */
export function planAudioExport(songSeconds: number, range: TimeRange | null): AudioExportPlan {
  let startSeconds = 0;
  let endSeconds = songSeconds;
  if (range) {
    if (!Number.isFinite(range.startSeconds) || !Number.isFinite(range.endSeconds)) {
      return { ok: false, reason: 'The selected section is not valid.' };
    }
    startSeconds = Math.max(0, range.startSeconds);
    endSeconds = Math.min(songSeconds, range.endSeconds);
    if (startSeconds >= songSeconds || endSeconds <= startSeconds) {
      return { ok: false, reason: 'The selected section is empty or outside the song.' };
    }
  }
  const durationSeconds = endSeconds - startSeconds;
  return { ok: true, startSeconds, durationSeconds };
}

/** Cuts `durationSeconds` of audio from `startSeconds`, padding with silence past the end. */
export function slicePcm(pcm: PcmAudio, startSeconds: number, durationSeconds: number): PcmAudio {
  const from = Math.max(0, Math.round(startSeconds * pcm.sampleRate));
  const length = Math.ceil(durationSeconds * pcm.sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  left.set(pcm.left.subarray(from, from + length));
  right.set(pcm.right.subarray(from, from + length));
  return { left, right, sampleRate: pcm.sampleRate };
}

/** Encodes stereo audio as a 16-bit PCM WAV file. Samples outside -1..1 are clipped. */
export function encodeWav(pcm: PcmAudio): Uint8Array<ArrayBuffer> {
  const frames = Math.min(pcm.left.length, pcm.right.length);
  const dataBytes = frames * 4;
  const out = new Uint8Array(new ArrayBuffer(44 + dataBytes));
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  const toInt = (x: number) => {
    const c = Math.max(-1, Math.min(1, x));
    return Math.round(c < 0 ? c * 32768 : c * 32767);
  };
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 4, toInt(pcm.left[i]), true);
    view.setInt16(46 + i * 4, toInt(pcm.right[i]), true);
  }
  return out;
}

/** File name for a saved audio file; the video export keeps its own `-highway.mp4` name. */
export function audioFilename(title: string, loop = false): string {
  const base = title.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
  return `${base || 'tab'}${loop ? '-loop' : ''}-audio.wav`;
}
