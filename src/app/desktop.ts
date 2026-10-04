/**
 * The page's only link to the desktop shell. The shell injects a global; on the web there is none, so
 * every call here degrades to "web". No Tauri package is imported, so the web bundle is unchanged.
 */

interface ShellGlobal {
  core: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> };
}

export class DesktopUnavailable extends Error {
  constructor() {
    super('This needs the desktop app.');
  }
}

/** The shell's command surface, or null when this page is not running inside the desktop app. */
export function getShell(host: object = globalThis): ShellGlobal | null {
  const tauri = (host as { __TAURI__?: { core?: { invoke?: unknown } } }).__TAURI__;
  return typeof tauri?.core?.invoke === 'function' ? (tauri as ShellGlobal) : null;
}

export function isDesktop(host: object = globalThis): boolean {
  return getShell(host) !== null;
}

/** Calls a shell command; rejects with DesktopUnavailable on the web. */
export async function invokeShell<T>(command: string, args?: Record<string, unknown>, host: object = globalThis): Promise<T> {
  const shell = getShell(host);
  if (!shell) throw new DesktopUnavailable();
  return (await shell.core.invoke(command, args)) as T;
}
