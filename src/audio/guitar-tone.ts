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
