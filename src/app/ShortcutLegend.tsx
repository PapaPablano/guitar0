import { shortcutLegend } from './shortcuts';

/** The keys that work on the player, as a quiet line under the controls. */
export function ShortcutLegend() {
  return (
    <p className="shortcut-legend muted" aria-label="Keyboard shortcuts">
      {shortcutLegend().map((entry) => (
        <span key={entry.action}>
          {entry.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}{' '}
          {entry.text}
        </span>
      ))}
    </p>
  );
}
