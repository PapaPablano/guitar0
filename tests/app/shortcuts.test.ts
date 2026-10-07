import { describe, expect, it } from 'vitest';
import { interpretKey } from '../../src/app/navigation';
import { SHORTCUT_LEGEND, shortcutLegend } from '../../src/app/shortcuts';

describe('shortcut legend', () => {
  it('lists only keys the handler really maps to that action', () => {
    for (const [action, entry] of Object.entries(SHORTCUT_LEGEND)) {
      for (const key of entry.keys) expect(interpretKey(key, { tag: 'body' })).toBe(action);
    }
  });

  it('shows keys the way they are read on a keyboard', () => {
    const byAction = Object.fromEntries(shortcutLegend().map((e) => [e.action, e.keys]));
    expect(byAction['toggle-play']).toEqual(['Space']);
    expect(byAction['seek-back']).toEqual(['←']);
    expect(byAction['toggle-loop']).toEqual(['L']);
  });
});
