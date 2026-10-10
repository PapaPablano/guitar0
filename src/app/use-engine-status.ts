import { useEffect, useState } from 'react';
import { isDesktop } from './desktop';
import { readEngineStatus, type ShellEngineStatus } from './engine-state';

const STATUS_POLL_MS = 1000;

/** The desktop shell's report on setup and the stem engine, refreshed every second; null on the web or before the first reply. */
export function useEngineStatus(): ShellEngineStatus | null {
  const desktop = isDesktop();
  const [status, setStatus] = useState<ShellEngineStatus | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let stopped = false;
    const tick = () => {
      readEngineStatus().then(
        (s) => !stopped && setStatus(s),
        () => undefined,
      );
    };
    tick();
    const id = setInterval(tick, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [desktop]);
  return status;
}
