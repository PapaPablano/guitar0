import { describe, expect, it, vi } from 'vitest';
import { escapeCloses, menuPanelClick, menuToggleHandler } from '../../src/app/Menu';

const toggle = (open: boolean) => {
  const details = { open };
  return { target: details, currentTarget: details } as unknown as Parameters<ReturnType<typeof menuToggleHandler>>[0];
};

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

describe('Menu toggle from a nested menu', () => {
  it('ignores a toggle that came from a menu inside the panel, so opening a row menu does not re-read the songs', () => {
    const onOpen = vi.fn();
    const onChange = vi.fn();
    const outer = { open: true };
    const inner = { open: true };
    menuToggleHandler(onOpen, onChange)({ target: inner, currentTarget: outer } as unknown as Parameters<ReturnType<typeof menuToggleHandler>>[0]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('menuPanelClick', () => {
  const target = (insideControl: boolean) => ({ closest: (selector: string) => (insideControl && selector === 'button, a' ? {} : null) });

  it('closes on a button or link and keeps open on anything else', () => {
    expect(menuPanelClick(target(true), false)).toEqual({ close: true, stop: false });
    expect(menuPanelClick(target(false), false)).toEqual({ close: false, stop: false });
  });

  it('with keepParentOpen, stops the click so the menu around it stays open (KTD8)', () => {
    expect(menuPanelClick(target(true), true)).toEqual({ close: true, stop: true });
    expect(menuPanelClick(target(false), true)).toEqual({ close: false, stop: true });
  });
});

describe('escapeCloses', () => {
  const details = (open: boolean, openInside: boolean) => ({ open, querySelector: (s: string) => (openInside && s === 'details[open]' ? {} : null) });
  const key = (k: string, defaultPrevented = false) => ({ key: k, defaultPrevented });

  it('closes an open menu on Escape only', () => {
    expect(escapeCloses(key('Escape'), details(true, false))).toBe(true);
    expect(escapeCloses(key('Enter'), details(true, false))).toBe(false);
    expect(escapeCloses(key('Escape'), details(false, false))).toBe(false);
    expect(escapeCloses(key('Escape'), null)).toBe(false);
  });

  it('closes only the innermost open menu: the Songs menu stays open while a row menu inside it is open (KTD8)', () => {
    expect(escapeCloses(key('Escape'), details(true, true))).toBe(false);
  });

  it('leaves an Escape another handler already used, such as the inner menu or the rename input (KTD8)', () => {
    expect(escapeCloses(key('Escape', true), details(true, false))).toBe(false);
  });
});
