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

  it('does nothing without a callback', () => {
    expect(() => menuToggleHandler(undefined)(toggle(true))).not.toThrow();
  });
});
