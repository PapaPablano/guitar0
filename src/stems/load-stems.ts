import { createWebAudioChannel, StemMixClock, type StemChannel } from '../audio/stem-mix';
import type { StemSources } from '../export/stem-audio';
import { EngineClient, STEM_NAMES } from './engine-client';

export interface LoadedStems {
  readonly clock: StemMixClock;
  readonly sources: StemSources;
}

/**
 * Downloads a finished job's stems and builds the clock that plays them. If any stem fails, everything
 * created so far is released and the error is thrown, so no stem is left playing out of step.
 */
export async function loadStems(client: EngineClient, jobId: string, durationSeconds: number, context: AudioContext): Promise<LoadedStems> {
  const blobs = await Promise.all(STEM_NAMES.map((name) => client.fetchStem(jobId, name)));
  const sources = {} as StemSources;
  STEM_NAMES.forEach((name, i) => {
    sources[name] = blobs[i];
  });

  const urls = blobs.map((b) => URL.createObjectURL(b));
  const settled = await Promise.allSettled(STEM_NAMES.map((name, i) => createWebAudioChannel(context, name, urls[i])));
  const channels: StemChannel[] = [];
  let failure: unknown = null;
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') channels.push(result.value);
    else {
      failure ??= result.reason;
      URL.revokeObjectURL(urls[i]);
    }
  });
  if (failure) {
    for (const c of channels) c.dispose();
    throw failure instanceof Error ? failure : new Error('The stems could not be loaded.');
  }
  return { clock: new StemMixClock(channels, durationSeconds), sources };
}
