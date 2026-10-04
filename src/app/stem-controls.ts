import type { EngineView } from './engine-state';
import type { MixState } from '../audio/mix-gains';
import type { StemName } from '../stems/engine-client';

export interface SeparateControl {
  readonly visible: boolean;
  readonly label: 'Separate' | 'Use saved stems';
  readonly disabled: boolean;
  /** Why the control is disabled, or setup progress; empty when there is nothing to say. */
  readonly note: string;
}

/** What the separate control shows. Nothing on the web build (the engine view is "web"). */
export function separateControl(args: { engine: EngineView; hasRecording: boolean; hasSaved: boolean; busy: boolean }): SeparateControl {
  const { engine, hasRecording, hasSaved, busy } = args;
  const label = hasSaved ? 'Use saved stems' : 'Separate';
  if (engine.kind === 'web') return { visible: false, label, disabled: true, note: '' };
  if (!engine.stemsEnabled) return { visible: true, label, disabled: true, note: engine.message };
  if (!hasRecording) return { visible: true, label, disabled: true, note: 'Load your recording to split it into stems.' };
  return { visible: true, label, disabled: busy, note: '' };
}

const clone = (mix: MixState): MixState => JSON.parse(JSON.stringify(mix)) as MixState;

export function toggleStemMute(mix: MixState, name: StemName): MixState {
  const next = clone(mix);
  next[name].muted = !next[name].muted;
  return next;
}

export function toggleStemSolo(mix: MixState, name: StemName): MixState {
  const next = clone(mix);
  next[name].solo = !next[name].solo;
  return next;
}

export function setStemVolume(mix: MixState, name: StemName, volume: number): MixState {
  const next = clone(mix);
  next[name].volume = Math.min(1, Math.max(0, volume));
  return next;
}
