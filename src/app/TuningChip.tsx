import { fileTuningOptions } from './file-tuning-options';
import { presetsForTrack, sameTuning, TUNING_PRESETS } from '../model/retune';
import type { TrackInfo } from '../model/score';
import { FileTuningPicker } from './FileTuningPicker';
import { Menu } from './Menu';
import { TuningPicker } from './TuningPicker';

interface TuningChipProps {
  track: TrackInfo | undefined;
  /** The track as the file wrote it, before any tuning change. */
  sourceTrack: TrackInfo | undefined;
  written: readonly number[];
  tuningId: string;
  onTuningChange: (id: string) => void;
  onFileTuningChange: (id: string) => void;
}

/** One chip for the track's tuning; its panel holds "File is actually tuned to" and "Show in tuning". Hidden when neither has a choice. */
export function TuningChip({ track, sourceTrack, written, tuningId, onTuningChange, onFileTuningChange }: TuningChipProps) {
  const current = sourceTrack?.tuning ?? [];
  const hasFileChoice = fileTuningOptions(written, current).options.length > 0;
  const hasShowChoice = presetsForTrack(sourceTrack).length > 0;
  if (!hasFileChoice && !hasShowChoice) return null;
  const name = track ? TUNING_PRESETS.find((p) => sameTuning(p.tuning, track.tuning))?.name : undefined;
  return (
    <Menu className="tuning-chip" label={<><span className="muted">Tuning</span> {name ?? 'Custom'}</>}>
      <FileTuningPicker written={written} current={current} onChange={onFileTuningChange} />
      <TuningPicker track={sourceTrack} value={tuningId} onChange={onTuningChange} />
    </Menu>
  );
}
