import type { EngineView } from './engine-state';
import { MAX_STEM_VOLUME, type MixState } from '../audio/mix-gains';
import type { SearchItem, StemName } from '../stems/engine-client';

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
  next[name].volume = Math.min(MAX_STEM_VOLUME, Math.max(0, volume));
  return next;
}

/**
 * The guitar amount is the guitar stem's own volume, shown as the headline control from none (0) to full (1).
 * Playback and the export both read it through stemGains, so they always blend the same.
 */
export function guitarAmount(mix: MixState): number {
  return mix.guitar.muted ? 0 : Math.min(1, mix.guitar.volume);
}

/**
 * Sets the guitar amount (clamped to 0..1) as the guitar's volume. Raising it above 0 unmutes the guitar so the
 * control is never stuck silent; solo and the other stems are untouched.
 */
export function setGuitarAmount(mix: MixState, amount: number): MixState {
  const next = setStemVolume(mix, 'guitar', Math.min(1, Math.max(0, amount)));
  if (next.guitar.volume > 0) next.guitar.muted = false;
  return next;
}

export function guitarAmountLabel(amount: number): string {
  if (amount <= 0) return 'None';
  if (amount >= 1) return 'Full';
  return volumeLabel(amount);
}

/** A stem's level as a percentage; 100% is the original level. */
export function volumeLabel(volume: number): string {
  return `${Math.round(volume * 100)}%`;
}

/** 3:05, or 1:02:05 for an hour or more; empty when the length is unknown. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export interface SearchRow {
  readonly title: string;
  readonly detail: string;
  readonly disabled: boolean;
  readonly note: string;
}

/** What one search result shows. A result over the engine's length limit cannot be imported. */
export function searchRow(item: SearchItem): SearchRow {
  const detail = [item.uploader, formatDuration(item.duration)].filter(Boolean).join(' · ');
  return {
    title: item.title,
    detail,
    disabled: item.too_long,
    note: item.too_long ? 'Too long to import' : '',
  };
}
