import { GUITAR_TONES, toneOfProgram, type GuitarTone } from '../audio/guitar-tone';

interface ToneSwitchProps {
  /** The tone chosen for this track, or undefined to play the sound the tab wrote. */
  value: GuitarTone | undefined;
  /** The General MIDI program the tab gives this track. */
  written: number;
  onChange: (tone: GuitarTone | undefined) => void;
}

/** Picks how the guitar on screen sounds: as the tab wrote it, or Clean, Crunch or Distortion. */
export function ToneSwitch({ value, written, onChange }: ToneSwitchProps) {
  const own = toneOfProgram(written);
  const ownLabel = own ? `As written (${GUITAR_TONES.find((t) => t.id === own)!.label})` : 'As written';
  return (
    <div role="group" aria-label="Guitar sound" className="segmented tone-switch">
      <button type="button" aria-pressed={value === undefined} onClick={() => onChange(undefined)}>
        {ownLabel}
      </button>
      {GUITAR_TONES.map((t) => (
        <button key={t.id} type="button" aria-pressed={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
