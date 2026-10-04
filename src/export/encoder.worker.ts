import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { hydrateTimeline, type TimelineData } from '../model/serialize';
import { renderComposite, type BottomOptions, type CompositeContext } from '../render/composite';
import type { PcmAudio } from './audio';
import { audioConfig, videoConfigFor } from './capability';
import { AUDIO_CHANNELS, frameCount, frameTime, type ExportPreset } from './presets';

export interface StartMessage {
  type: 'start';
  data: TimelineData;
  trackIndex: number;
  preset: ExportPreset;
  audio: PcmAudio;
  /** The bottom view the video shows, chosen when the export started. */
  bottom: BottomOptions;
}

export type WorkerMessage = StartMessage | { type: 'cancel' };

export type WorkerReply =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; buffer: ArrayBuffer }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerMessage>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
};

let cancelled = false;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

scope.onmessage = (e) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  run(e.data).catch((err: unknown) => {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  });
};

async function run(msg: StartMessage): Promise<void> {
  const { preset, audio } = msg;
  const timeline = hydrateTimeline(msg.data);
  const canvas = new OffscreenCanvas(preset.width, preset.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing surface for the export.');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: preset.width, height: preset.height },
    audio: { codec: 'aac', sampleRate: audio.sampleRate, numberOfChannels: AUDIO_CHANNELS },
    fastStart: 'in-memory',
  });

  let failure: Error | null = null;
  const onError = (err: Error) => {
    failure = err;
  };
  const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: onError });
  videoEncoder.configure(videoConfigFor(preset));
  const audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: onError });
  audioEncoder.configure(audioConfig());

  // Audio first: it is already rendered, so it goes in as one-second blocks.
  const block = audio.sampleRate;
  for (let start = 0; start < audio.left.length; start += block) {
    if (cancelled) return finishCancelled(videoEncoder, audioEncoder);
    const frames = Math.min(block, audio.left.length - start);
    const planar = new Float32Array(frames * AUDIO_CHANNELS);
    planar.set(audio.left.subarray(start, start + frames), 0);
    planar.set(audio.right.subarray(start, start + frames), frames);
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: audio.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: AUDIO_CHANNELS,
      timestamp: Math.round((start / audio.sampleRate) * 1e6),
      data: planar,
    });
    audioEncoder.encode(data);
    data.close();
    while (audioEncoder.encodeQueueSize > 8) await sleep(1);
    await sleep(0); // let a cancel message through
  }

  const total = frameCount(timeline.durationSeconds, preset.fps);
  for (let frame = 0; frame < total; frame++) {
    if (cancelled) return finishCancelled(videoEncoder, audioEncoder);
    if (failure) throw failure;
    renderComposite(
      ctx as unknown as CompositeContext,
      timeline,
      msg.trackIndex,
      frameTime(frame, preset.fps),
      preset.width,
      preset.height,
      { bottom: msg.bottom },
    );
    const videoFrame = new VideoFrame(canvas, {
      timestamp: Math.round((frame * 1e6) / preset.fps),
      duration: Math.round(1e6 / preset.fps),
    });
    videoEncoder.encode(videoFrame, { keyFrame: frame % (preset.fps * 2) === 0 });
    videoFrame.close();
    while (videoEncoder.encodeQueueSize > 8) await sleep(1);
    if (frame % 15 === 0) scope.postMessage({ type: 'progress', fraction: frame / total });
    if (frame % 16 === 0) await sleep(0); // let a cancel message through even when the encoder keeps up
  }

  await videoEncoder.flush();
  await audioEncoder.flush();
  if (failure) throw failure;
  muxer.finalize();
  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  scope.postMessage({ type: 'done', buffer }, [buffer]);
}

function finishCancelled(video: VideoEncoder, audio: AudioEncoder): void {
  try {
    video.close();
    audio.close();
  } catch {
    // already closed
  }
  scope.postMessage({ type: 'cancelled' });
}
