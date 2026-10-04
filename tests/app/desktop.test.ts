import { describe, expect, it, vi } from 'vitest';
import { DesktopUnavailable, getShell, invokeShell, isDesktop } from '../../src/app/desktop';

describe('desktop bridge', () => {
  it('reports web when no shell global is present', () => {
    expect(isDesktop({})).toBe(false);
    expect(getShell({})).toBeNull();
  });

  it('reports desktop and calls a command through the shell', async () => {
    const invoke = vi.fn().mockResolvedValue({ phase: 'ready' });
    const host = { __TAURI__: { core: { invoke } } };
    expect(isDesktop(host)).toBe(true);
    await expect(invokeShell('engine_status', { a: 1 }, host)).resolves.toEqual({ phase: 'ready' });
    expect(invoke).toHaveBeenCalledWith('engine_status', { a: 1 });
  });

  it('treats a global without the command surface as web', () => {
    expect(isDesktop({ __TAURI__: {} })).toBe(false);
    expect(isDesktop({ __TAURI__: { core: {} } })).toBe(false);
  });

  it('rejects a command with DesktopUnavailable on the web', async () => {
    await expect(invokeShell('engine_status', undefined, {})).rejects.toBeInstanceOf(DesktopUnavailable);
  });
});
