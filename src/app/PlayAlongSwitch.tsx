interface PlayAlongSwitchProps {
  on: boolean;
  onToggle: () => void;
}

/** Silences the track on screen so the rest of the band plays without it. */
export function PlayAlongSwitch({ on, onToggle }: PlayAlongSwitchProps) {
  return (
    <button
      type="button"
      className="play-along"
      aria-pressed={on}
      title="Mute this track so the rest of the band plays without it"
      onClick={onToggle}
    >
      Play along
    </button>
  );
}
