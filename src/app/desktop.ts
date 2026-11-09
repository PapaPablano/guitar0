/**
 * The page's only link to the desktop shell. The shell injects a global; on the web there is none, so
 * every call here degrades to "web". No Tauri package is imported, so the web bundle is unchanged.
 */

interface ShellGlobal {
  core: { invoke(command: string, args?: Record<string, unknown> | Uint8Array, options?: { headers?: Record<string, string> }): Promise<unknown> };
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

type Listen = (event: string, handler: () => void) => Promise<() => void>;

/**
 * Runs `handler` each time the shell emits `event`, through the shell's global event surface. Returns a function that
 * stops listening, safe to call before the registration has finished and more than once. Does nothing on the web.
 */
export function listenShell(event: string, handler: () => void, host: object = globalThis): () => void {
  const listen = getShell(host) && (host as { __TAURI__: { event?: { listen?: unknown } } }).__TAURI__.event?.listen;
  if (typeof listen !== 'function') return () => undefined;
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void (listen as Listen)(event, () => handler()).then(
    (stop) => {
      if (stopped) stop();
      else unlisten = stop;
    },
    () => undefined,
  );
  return () => {
    if (stopped) return;
    stopped = true;
    unlisten?.();
    unlisten = null;
  };
}

/** Calls a shell command; rejects with DesktopUnavailable on the web. */
export async function invokeShell<T>(command: string, args?: Record<string, unknown>, host: object = globalThis): Promise<T> {
  const shell = getShell(host);
  if (!shell) throw new DesktopUnavailable();
  return (await shell.core.invoke(command, args)) as T;
}

/** Opens a web link: through the shell in the desktop app (its webview drops new-window requests), a new tab on the web. */
export async function openExternal(url: string, host: object = globalThis): Promise<void> {
  if (getShell(host)) {
    await invokeShell('open_external', { url }, host);
    return;
  }
  (host as { open?: (url: string, target: string, features: string) => unknown }).open?.(url, '_blank', 'noopener,noreferrer');
}

/** Calls a shell command with raw bytes as its body (no JSON), for large data sent in slices; rejects on the web. */
export async function invokeShellRaw(command: string, bytes: Uint8Array, headers: Record<string, string>, host: object = globalThis): Promise<void> {
  const shell = getShell(host);
  if (!shell) throw new DesktopUnavailable();
  await shell.core.invoke(command, bytes, { headers });
}

/** Calls a shell command whose answer is raw bytes (a `tauri::ipc::Response`), returned as a byte array; rejects on the web. */
export async function invokeShellBytes(command: string, args: Record<string, unknown>, host: object = globalThis): Promise<Uint8Array> {
  const shell = getShell(host);
  if (!shell) throw new DesktopUnavailable();
  const answer = await shell.core.invoke(command, args);
  if (answer instanceof ArrayBuffer) return new Uint8Array(answer);
  if (ArrayBuffer.isView(answer)) return new Uint8Array(answer.buffer.slice(answer.byteOffset, answer.byteOffset + answer.byteLength));
  if (Array.isArray(answer) && answer.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) return Uint8Array.from(answer as number[]);
  throw new Error(`${command} did not answer with bytes.`);
}
