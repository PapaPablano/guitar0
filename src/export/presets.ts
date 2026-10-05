export interface ExportPreset {
  readonly id: 'landscape' | 'vertical';
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly videoBitrate: number;
  /** H.264 High profile, level 4.2 (enough for 1080p at 60 fps). */
  readonly videoCodec: string;
}

/** H.264 High profile, level 4.2: enough for 1080p at 60 fps. */
const VIDEO_CODEC = 'avc1.64002a';
export const AUDIO_CODEC = 'mp4a.40.2'; // AAC-LC, plays in every common player
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BITRATE = 160_000;

/** Songs longer than this are refused before encoding starts, to keep memory in check. */
export const MAX_EXPORT_SECONDS = 600;

export const PRESETS: readonly ExportPreset[] = [
  { id: 'landscape', label: '1080p, 60 fps (landscape)', width: 1920, height: 1080, fps: 60, videoBitrate: 8_000_000, videoCodec: VIDEO_CODEC },
  { id: 'vertical', label: '1080 x 1920, 30 fps (vertical)', width: 1080, height: 1920, fps: 30, videoBitrate: 6_000_000, videoCodec: VIDEO_CODEC },
];

export function presetById(id: string): ExportPreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

export function frameCount(durationSeconds: number, fps: number): number {
  return Math.max(1, Math.ceil(durationSeconds * fps));
}

/** Time of a frame in the song: export is driven by the frame number, never by a wall clock. */
export function frameTime(frame: number, fps: number): number {
  return frame / fps;
}

/** Rough size in megabytes of the finished file, for the dialog's estimate. */
export function estimateMegabytes(preset: ExportPreset, durationSeconds: number): number {
  return ((preset.videoBitrate + AUDIO_BITRATE) * durationSeconds) / 8 / 1_000_000;
}
