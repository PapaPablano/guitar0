/** The three guitar sounds a track can be switched to. */
export type GuitarTone = 'clean' | 'crunch' | 'distortion';

export const GUITAR_TONES: readonly { readonly id: GuitarTone; readonly label: string; readonly program: number }[] = [
  { id: 'clean', label: 'Clean', program: 27 },
  { id: 'crunch', label: 'Crunch', program: 29 },
  { id: 'distortion', label: 'Distortion', program: 30 },
];

/** General MIDI programs 24 to 31 are the guitars: nylon, steel, jazz, clean, muted, overdrive, distortion, harmonics. */
const FIRST_GUITAR_PROGRAM = 24;
const LAST_GUITAR_PROGRAM = 31;

/** The General MIDI program that plays a tone. */
export function programForTone(tone: GuitarTone): number {
  return GUITAR_TONES.find((t) => t.id === tone)!.program;
}

/** The tone a program is, or null for any other sound (acoustic, jazz, muted, bass, keys). */
export function toneOfProgram(program: number): GuitarTone | null {
  return GUITAR_TONES.find((t) => t.program === program)?.id ?? null;
}

/** A sound addressed by bank and program, as the synth selects it. */
export interface MutedPreset {
  readonly bank: number;
  readonly program: number;
}

/** The palm-mute preset the active banks have for each tone, where they have one (KTD2, KTD5). */
export type MutedPresets = Readonly<Partial<Record<GuitarTone, MutedPreset>>>;

/** General MIDI's muted guitar at bank 0: the one muted sound for every tone with no tone-matched mute (R6). */
export const SHARED_MUTED: MutedPreset = { bank: 0, program: 28 };

/**
 * What a palm-muted note plays while its track is on `program` at `bank` (KTD5): the tone's own muted preset, else the shared
 * muted sound. Any program that is not one of the three tones (acoustics, jazz, harmonics) plays itself, as palm mutes do today.
 */
export function mutedSound(program: number, bank: number, presets: MutedPresets = {}): MutedPreset {
  const tone = toneOfProgram(program);
  if (tone === null) return { bank, program };
  return presets[tone] ?? SHARED_MUTED;
}

/**
 * The program whose level a palm-mute part is evened out with: the shared muted sound's for a tone, since a muted preset has
 * no level of its own in the tables, and the parent's own for any other program.
 */
export function mutedLevelProgram(parentProgram: number): number {
  return toneOfProgram(parentProgram) === null ? parentProgram : SHARED_MUTED.program;
}

/** True when a track's own program is a guitar, so the tone switch applies to it. Bass and keys keep their sound. */
export function isGuitarProgram(program: number): boolean {
  return program >= FIRST_GUITAR_PROGRAM && program <= LAST_GUITAR_PROGRAM;
}

/** The program each overridden track plays: only tracks with a chosen tone appear, so every other track keeps what the tab wrote. */
export function programOverrides(tones: Readonly<Record<number, GuitarTone>>): Map<number, number> {
  const overrides = new Map<number, number>();
  for (const [track, tone] of Object.entries(tones)) overrides.set(Number(track), programForTone(tone));
  return overrides;
}

/** True when the tone switch belongs on screen: a guitar track, with the synth being heard (not a loaded recording or stems). */
export function canSwitchTone(track: { isPercussion: boolean; program: number } | undefined, recordingLoaded: boolean): boolean {
  return !recordingLoaded && track !== undefined && !track.isPercussion && isGuitarProgram(track.program);
}
