import { AUDIO_BITRATE, AUDIO_CHANNELS, AUDIO_CODEC, AUDIO_SAMPLE_RATE, type ExportPreset } from './presets';

/** The parts of the WebCodecs API the check needs, so tests can pass fakes. */
export interface ExportEnvironment {
  readonly VideoEncoder?: {
    isConfigSupported(config: VideoEncoderConfig): Promise<{ supported?: boolean }>;
  };
  readonly AudioEncoder?: {
    isConfigSupported(config: AudioEncoderConfig): Promise<{ supported?: boolean }>;
  };
  readonly OffscreenCanvas?: unknown;
  /** False on a plain http page, where browsers switch WebCodecs off. */
  readonly isSecureContext?: boolean;
}

export interface ExportSupport {
  readonly supported: boolean;
  /** Shown to the user when export is not available. */
  readonly reason: string | null;
}

export const UNSUPPORTED_MESSAGE =
  'Video export needs desktop Chrome or Edge. Practice mode works in this browser; open the page in Chrome or Edge to export.';

export const INSECURE_MESSAGE =
  'Video export only works on a secure (https) page. Open the https address of this site, or localhost, to export.';

export function videoConfigFor(preset: ExportPreset): VideoEncoderConfig {
  return {
    codec: preset.videoCodec,
    width: preset.width,
    height: preset.height,
    framerate: preset.fps,
    bitrate: preset.videoBitrate,
  };
}

export function audioConfig(): AudioEncoderConfig {
  return { codec: AUDIO_CODEC, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate: AUDIO_BITRATE };
}

/**
 * Checks that this browser can encode the exact H.264 and AAC configurations a preset needs, not
 * just that WebCodecs exists, so a failure shows up before a long render rather than during it.
 */
export async function checkExportSupport(env: ExportEnvironment, preset: ExportPreset): Promise<ExportSupport> {
  if (env.isSecureContext === false) return { supported: false, reason: INSECURE_MESSAGE };
  if (!env.VideoEncoder || !env.AudioEncoder || !env.OffscreenCanvas) {
    return { supported: false, reason: UNSUPPORTED_MESSAGE };
  }
  try {
    const video = await env.VideoEncoder.isConfigSupported(videoConfigFor(preset));
    const audio = await env.AudioEncoder.isConfigSupported(audioConfig());
    if (!video.supported || !audio.supported) return { supported: false, reason: UNSUPPORTED_MESSAGE };
  } catch {
    return { supported: false, reason: UNSUPPORTED_MESSAGE };
  }
  return { supported: true, reason: null };
}

export function browserExportEnvironment(): ExportEnvironment {
  const g = globalThis as unknown as ExportEnvironment;
  return {
    VideoEncoder: g.VideoEncoder,
    AudioEncoder: g.AudioEncoder,
    OffscreenCanvas: g.OffscreenCanvas,
    isSecureContext: g.isSecureContext,
  };
}
