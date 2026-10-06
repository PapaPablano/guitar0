import { RecordingPcm, type OpenResult, type PcmDeps } from './recording-pcm';

const opened = new WeakMap<Blob, Promise<OpenResult>>();

/**
 * The one store of a recording's decoded audio, opened the first time it is asked for and shared by everything that needs the
 * audio: the exact copy that seeking uses, the analysis and the export. It lives as long as the file object does.
 */
export function openSharedPcm(file: Blob, durationSeconds: number, deps?: PcmDeps): Promise<OpenResult> {
  const known = opened.get(file);
  if (known) return known;
  const started = RecordingPcm.open(file, durationSeconds, deps);
  opened.set(file, started);
  return started;
}

/** The store of a recording that has been opened, or null when nobody has asked for it yet or it cannot be kept. */
export async function peekSharedPcm(file: Blob): Promise<RecordingPcm | null> {
  const known = opened.get(file);
  if (!known) return null;
  const result = await known;
  return result.kind === 'ready' ? result.pcm : null;
}
