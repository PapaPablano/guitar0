import { invokeShell } from './desktop';

/** What the shell reports about first-launch setup and the stem engine. */
export interface ShellEngineStatus {
  readonly phase: 'setup-needed' | 'setting-up' | 'setup-failed' | 'starting' | 'restarting' | 'ready' | 'engine-error';
  /** 0 to 1 while setting up; absent or null when the amount done is unknown. */
  readonly progress?: number | null;
  readonly message?: string;
  /** Present once ready: where the engine listens and the secret every request must carry. */
  readonly url?: string;
  readonly secret?: string;
}

export interface EngineView {
  readonly kind: 'web' | 'setup' | 'restarting' | 'ready' | 'blocked';
  readonly stemsEnabled: boolean;
  readonly canRetry: boolean;
  /** True while setup is actively running (as opposed to needed, failed or starting). */
  readonly busy: boolean;
  readonly message: string;
  readonly progress: number | null;
}

const WEB: EngineView = { kind: 'web', stemsEnabled: false, canRetry: false, busy: false, message: '', progress: null };

/** Turns the shell's status into what the page shows. `null` means the web build. */
export function describeEngine(status: ShellEngineStatus | null): EngineView {
  if (!status) return WEB;
  const message = status.message ?? '';
  const progress = typeof status.progress === 'number' ? Math.min(1, Math.max(0, status.progress)) : null;
  switch (status.phase) {
    case 'ready':
      return { kind: 'ready', stemsEnabled: true, canRetry: false, busy: false, message, progress: null };
    case 'setup-needed':
      return { kind: 'setup', stemsEnabled: false, canRetry: true, busy: false, message: message || 'Stem separation needs a one-time setup.', progress: null };
    case 'setting-up':
      return { kind: 'setup', stemsEnabled: false, canRetry: false, busy: true, message: message || 'Setting up stem separation…', progress };
    case 'setup-failed':
      return { kind: 'setup', stemsEnabled: false, canRetry: true, busy: false, message: `Setup did not finish. ${message}`.trim(), progress: null };
    case 'starting':
      return { kind: 'setup', stemsEnabled: false, canRetry: false, busy: false, message: message || 'Starting the stem engine…', progress: null };
    case 'restarting':
      return { kind: 'restarting', stemsEnabled: false, canRetry: false, busy: false, message: message || 'The stem engine stopped; restarting it…', progress: null };
    case 'engine-error':
      return { kind: 'blocked', stemsEnabled: false, canRetry: true, busy: false, message: `The stem engine stopped. ${message}`.trim(), progress: null };
  }
}

/** What the setup bar shows: a value, an indeterminate bar (setting up with no known progress), or nothing. */
export type SetupBar = { readonly kind: 'none' } | { readonly kind: 'indeterminate' } | { readonly kind: 'determinate'; readonly value: number };

export function setupBar(view: EngineView): SetupBar {
  if (view.kind !== 'setup' || !view.busy) return { kind: 'none' };
  return view.progress === null ? { kind: 'indeterminate' } : { kind: 'determinate', value: view.progress };
}

export function readEngineStatus(): Promise<ShellEngineStatus> {
  return invokeShell<ShellEngineStatus>('engine_status');
}

/** Starts or retries first-launch setup, or restarts a stopped engine. */
export function startEngineSetup(): Promise<void> {
  return invokeShell<void>('engine_setup');
}
