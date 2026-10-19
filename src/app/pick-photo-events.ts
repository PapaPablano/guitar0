const listeners = new Set<() => void>();

/** Tells every pick view the saved photo changed, so it loads the new one. Calibration calls this after saving or clearing. */
export function pickPhotoChanged(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` whenever the saved photo changes; returns how to stop. */
export function onPickPhotoChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
