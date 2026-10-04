import { serializeTimeline } from '../model/serialize';
import type { Timeline } from '../model/score';
import type { PcmAudio } from './audio';
import { fitPcm } from './audio';
import type { StartMessage, WorkerReply } from './encoder.worker';
import type { ExportPreset } from './presets';

export interface ExportJob {
  /** Resolves with the finished MP4, or rejects with `ExportCancelled` or an Error. */
  readonly result: Promise<Blob>;
  cancel(): void;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

/** Starts an export in a worker; the main thread stays free and the page stays responsive. */
export function startExport(args: {
  timeline: Timeline;
  trackIndex: number;
  preset: ExportPreset;
  audio: PcmAudio;
  onProgress: (fraction: number) => void;
}): ExportJob {
  const worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' });
  const audio = fitPcm(args.audio, args.timeline.durationSeconds);

  const result = new Promise<Blob>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const reply = e.data;
      switch (reply.type) {
        case 'progress':
          args.onProgress(reply.fraction);
          break;
        case 'done':
          worker.terminate();
          resolve(new Blob([reply.buffer], { type: 'video/mp4' }));
          break;
        case 'cancelled':
          worker.terminate();
          reject(new ExportCancelled());
          break;
        case 'error':
          worker.terminate();
          reject(new Error(reply.message));
          break;
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The export stopped unexpectedly.'));
    };
    const start: StartMessage = {
      type: 'start',
      data: serializeTimeline(args.timeline, args.trackIndex),
      trackIndex: args.trackIndex,
      preset: args.preset,
      audio,
    };
    worker.postMessage(start, [audio.left.buffer, audio.right.buffer]);
  });

  return {
    result,
    cancel: () => worker.postMessage({ type: 'cancel' }),
  };
}
