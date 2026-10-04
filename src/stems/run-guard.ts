/**
 * Tells a long-running action whether it is still the one that should apply its result. A separation can
 * finish minutes after it started, by which time the user may have opened another song or started a new run.
 */
export function createRunGuard() {
  let current = 0;
  return {
    /** Starts a run; every earlier run becomes stale. */
    begin: () => ++current,
    /** Makes the running run stale without starting another. */
    invalidate: () => {
      current += 1;
    },
    isCurrent: (run: number) => run === current,
  };
}
