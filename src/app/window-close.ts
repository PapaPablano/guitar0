/**
 * What the page does when the desktop window is closed (KTD6): the shell holds the close and emits `close-requested`;
 * the page saves the open song's position and then tells the shell it may exit. The shell exits on its own after 2 s,
 * so every step here is best effort and the shell is always told, whatever fails.
 */

/** How long the open song's pending saves get before the shell is told to exit anyway; under the shell's 2 s fallback. */
export const CLOSE_SAVE_CAP_MS = 1500;

export interface CloseSteps {
  /** Pauses every clock and saves the open song's position (U3's park). */
  park(): void;
  /** Writes the profile saver's pending change now; exiting through the shell may skip `pagehide`. */
  flush(): void;
  /** Resolves once the open song's saves have finished, the position saved by `park` included. */
  settled(): Promise<void>;
  /** Tells the shell the page is done (`app_close_ready`), which exits. */
  ready(): Promise<unknown>;
}

function attempt(step: () => void) {
  try {
    step();
  } catch {
    // best effort: the app is closing either way
  }
}

/** The close sequence; calls made while one is running share it, so a second close request saves nothing twice. */
export function createCloseHandler(steps: CloseSteps, capMs = CLOSE_SAVE_CAP_MS): () => Promise<void> {
  let running: Promise<void> | null = null;
  async function run() {
    attempt(steps.park);
    attempt(steps.flush);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cap = new Promise<void>((resolve) => (timer = setTimeout(resolve, capMs)));
      await Promise.race([Promise.resolve().then(steps.settled), cap]);
    } catch {
      // a failed save still lets the app close
    } finally {
      clearTimeout(timer);
    }
    try {
      await steps.ready();
    } catch {
      // the shell's own fallback exits
    }
  }
  return () => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };
}
