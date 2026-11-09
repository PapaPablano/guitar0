import { describe, expect, it, vi } from 'vitest';
import { menuToggleHandler } from '../../src/app/Menu';

const toggle = (open: boolean) => ({ currentTarget: { open } }) as unknown as Parameters<ReturnType<typeof menuToggleHandler>>[0];

describe('Menu onOpen', () => {
  it('fires when the panel opens, not when it closes', () => {
    const onOpen = vi.fn();
    const handler = menuToggleHandler(onOpen);
    handler(toggle(true));
    expect(onOpen).toHaveBeenCalledTimes(1);
    handler(toggle(false));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('reports whether the panel is open on every toggle, before onOpen', () => {
    const calls: string[] = [];
    const handler = menuToggleHandler(
      () => calls.push('onOpen'),
      (open) => calls.push(open ? 'open' : 'closed'),
    );
    handler(toggle(true));
    handler(toggle(false));
    expect(calls).toEqual(['open', 'onOpen', 'closed']);
  });

  it('does nothing without a callback', () => {
    expect(() => menuToggleHandler(undefined)(toggle(true))).not.toThrow();
  });
});
