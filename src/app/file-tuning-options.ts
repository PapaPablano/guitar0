import { sameTuning, TUNING_PRESETS } from '../model/retune';

/** Id meaning "the tuning the file was written with". */
export const WRITTEN = 'written';

export interface FileTuningOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The choices for "File is actually tuned to": the tuning the file was written with, then every other
 * preset with the same string count, and which one matches the track's tuning now.
 */
export function fileTuningOptions(
  written: readonly number[],
  current: readonly number[],
): { options: FileTuningOption[]; value: string } {
  if (written.length === 0) return { options: [], value: WRITTEN };
  const writtenName = TUNING_PRESETS.find((p) => sameTuning(p.tuning, written))?.name;
  const options: FileTuningOption[] = [{ id: WRITTEN, label: writtenName ? `As written (${writtenName})` : 'As written' }];
  for (const p of TUNING_PRESETS) {
    if (p.tuning.length === written.length && !sameTuning(p.tuning, written)) options.push({ id: p.id, label: p.name });
  }
  const match = TUNING_PRESETS.find((p) => sameTuning(p.tuning, current));
  const value = match && !sameTuning(match.tuning, written) ? match.id : WRITTEN;
  return { options, value };
}
