import type { ShortcutAction } from './navigation';

/** What the legend says for each key action; a missing entry is a type error, so a new shortcut cannot go unlisted. */
export const SHORTCUT_LEGEND: Record<ShortcutAction, { readonly keys: readonly string[]; readonly text: string }> = {
  'toggle-play': { keys: [' '], text: 'play' },
  'seek-back': { keys: ['ArrowLeft'], text: 'previous bar' },
  'seek-forward': { keys: ['ArrowRight'], text: 'next bar' },
  'tempo-up': { keys: ['ArrowUp'], text: 'faster' },
  'tempo-down': { keys: ['ArrowDown'], text: 'slower' },
  'toggle-loop': { keys: ['l'], text: 'loop' },
  'toggle-fullscreen': { keys: ['f'], text: 'full screen' },
};

const KEY_NAMES: Record<string, string> = { ' ': 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** The legend entries in display order, with each key as the player reads it on the keyboard. */
export function shortcutLegend(): { action: ShortcutAction; keys: string[]; text: string }[] {
  return (Object.keys(SHORTCUT_LEGEND) as ShortcutAction[]).map((action) => ({
    action,
    keys: SHORTCUT_LEGEND[action].keys.map((k) => KEY_NAMES[k] ?? k.toUpperCase()),
    text: SHORTCUT_LEGEND[action].text,
  }));
}
