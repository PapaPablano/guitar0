import { describe, expect, it, vi } from 'vitest';
import { DesktopUnavailable, getShell, invokeShell, invokeShellBytes, invokeShellRaw, isDesktop, listenShell, openExternal } from '../../src/app/desktop';

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

  it('sends raw bytes with headers to a command, and rejects on the web', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const host = { __TAURI__: { core: { invoke } } };
    const bytes = new Uint8Array([1, 2, 3]);
    await invokeShellRaw('export_append', bytes, { 'x-save-id': '7' }, host);
    expect(invoke).toHaveBeenCalledWith('export_append', bytes, { headers: { 'x-save-id': '7' } });
    await expect(invokeShellRaw('export_append', bytes, {}, {})).rejects.toBeInstanceOf(DesktopUnavailable);
  });

  it('returns a raw binary answer as bytes, and rejects on the web', async () => {
    const invoke = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]).buffer);
    const host = { __TAURI__: { core: { invoke } } };
    await expect(invokeShellBytes('library_read', { offset: 0 }, host)).resolves.toEqual(new Uint8Array([4, 5, 6]));
    expect(invoke).toHaveBeenCalledWith('library_read', { offset: 0 });
    await expect(invokeShellBytes('library_read', {}, {})).rejects.toBeInstanceOf(DesktopUnavailable);
  });

  it('accepts a byte view or a number list as a binary answer, and rejects anything else', async () => {
    const host = (answer: unknown) => ({ __TAURI__: { core: { invoke: vi.fn().mockResolvedValue(answer) } } });
    const view = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);
    await expect(invokeShellBytes('x', {}, host(view))).resolves.toEqual(new Uint8Array([1, 2]));
    await expect(invokeShellBytes('x', {}, host([7, 8]))).resolves.toEqual(new Uint8Array([7, 8]));
    await expect(invokeShellBytes('x', {}, host('text'))).rejects.toThrow();
    await expect(invokeShellBytes('x', {}, host(null))).rejects.toThrow();
  });
});

describe('openExternal', () => {
  it('asks the shell to open the link in the desktop app', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn();
    await openExternal('https://www.songsterr.com/?pattern=x', { __TAURI__: { core: { invoke } }, open });
    expect(invoke).toHaveBeenCalledWith('open_external', { url: 'https://www.songsterr.com/?pattern=x' });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a new tab on the web', async () => {
    const open = vi.fn();
    await openExternal('https://www.songsterr.com/?pattern=x', { open });
    expect(open).toHaveBeenCalledWith('https://www.songsterr.com/?pattern=x', '_blank', 'noopener,noreferrer');
  });
});

describe('listenShell', () => {
  function shellWithEvents() {
    const unlisten = vi.fn();
    const handlers = new Map<string, () => void>();
    const listen = vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return Promise.resolve(unlisten);
    });
    return { host: { __TAURI__: { core: { invoke: vi.fn() }, event: { listen } } }, listen, unlisten, handlers };
  }

  it('registers the handler through the shell and calls it on the event', async () => {
    const { host, listen, handlers } = shellWithEvents();
    const handler = vi.fn();
    listenShell('close-requested', handler, host);
    expect(listen).toHaveBeenCalledWith('close-requested', expect.any(Function));
    handlers.get('close-requested')?.();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns an unlisten that removes the registration, even before it has finished', async () => {
    const { host, unlisten } = shellWithEvents();
    const stop = listenShell('close-requested', () => undefined, host);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('calls the unlisten at once when the registration has already finished', async () => {
    const { host, unlisten } = shellWithEvents();
    const stop = listenShell('close-requested', () => undefined, host);
    await Promise.resolve();
    await Promise.resolve();
    stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the web', () => {
    const handler = vi.fn();
    const stop = listenShell('close-requested', handler, {});
    expect(() => stop()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing when the shell has no event surface', () => {
    const stop = listenShell('close-requested', () => undefined, { __TAURI__: { core: { invoke: vi.fn() } } });
    expect(() => stop()).not.toThrow();
  });
});
