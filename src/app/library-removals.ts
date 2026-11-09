/**
 * Pending song removals (KTD2): a removed song is hidden at once and kept in memory with an undo timer; the index is not
 * touched until the timer runs out, Back up and restore opens, or the window closes. A commit waits for every in-flight
 * save, removes the entry in one library step that re-checks the removal is still pending, and then deletes the files
 * that step says nothing else uses (KTD3, R4, R13). Nothing here knows about React or the shell; App wires it.
 */

import type { CommittedRemoval, LibraryEntry, RemovalContext } from './library';
import { TAB_EXTENSION, type DeleteResult, type LibraryKind, type StoreOptions } from './library-shell';

/** How long a removal can be undone before it commits (R2). */
export const REMOVAL_UNDO_MS = 8000;

/** One pending removal as the notices show it. */
export interface PendingRemoval {
  readonly tabHash: string;
  /** The entry as it was when removed, for the notice's name. */
  readonly entry: LibraryEntry;
  /** True while the player hovers or focuses its notice, which holds the timer. */
  readonly paused: boolean;
}

export interface RemovalTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface RemovalsOptions {
  /** Commits one removal; `pendingHashes` is the live set, read when the commit's library step runs. Should not reject. */
  commit: (tabHash: string, pendingHashes: ReadonlySet<string>) => Promise<unknown>;
  /** Removes every pending entry from the index at once, deleting nothing, for the window close. */
  dropEntries: (pendingHashes: ReadonlySet<string>) => Promise<unknown>;
  delay?: number;
  now?: () => number;
  timers?: RemovalTimers;
}

export interface Removals {
  /** Hides the song and starts its undo timer. False when its removal is already pending. */
  remove(entry: LibraryEntry): boolean;
  /** The notice's Undo: the song comes back as it was (R3). False when it was not pending. */
  undo(tabHash: string): boolean;
  /**
   * Opening the song or its file cancels its removal (R6), even once the timer has run out, as long as the commit's
   * library step has not run yet. False when it was not pending.
   */
  cancel(tabHash: string): boolean;
  /** Holds the timer while the notice is hovered or focused. */
  pause(tabHash: string): void;
  /** Runs out the rest of the timer. */
  resume(tabHash: string): void;
  /** Commits every pending removal now, resolving once all have finished (Back up and restore, R7). Never rejects. */
  commitAll(): Promise<void>;
  /** Stops every timer and removes every pending entry from the index without deleting files (window close). Never rejects. */
  dropEntriesAll(): Promise<void>;
  /** Tab hashes of every removal not yet finished, committing ones included; both lists hide these songs. Live. */
  pendingHashes(): ReadonlySet<string>;
  /** Removals whose notice shows, newest first. A new array after each change. */
  items(): readonly PendingRemoval[];
  /** Called after every change to `items` or `pendingHashes`; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

interface Item {
  readonly tabHash: string;
  readonly entry: LibraryEntry;
  paused: boolean;
  timer: unknown;
  /** Time left on the timer, as of `startedAt`. */
  remaining: number;
  startedAt: number;
  committing: Promise<void> | null;
}

const browserTimers: RemovalTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createRemovals(options: RemovalsOptions): Removals {
  const { commit, dropEntries, delay = REMOVAL_UNDO_MS, now = () => Date.now(), timers = browserTimers } = options;
  const items = new Map<string, Item>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  let shown: readonly PendingRemoval[] = [];
  let closing = false;

  function changed() {
    shown = [...items.values()]
      .filter((item) => item.committing === null)
      .reverse()
      .map(({ tabHash, entry, paused }) => ({ tabHash, entry, paused }));
    for (const listener of [...listeners]) listener();
  }

  function stopTimer(item: Item) {
    if (item.timer !== null) timers.clearTimeout(item.timer);
    item.timer = null;
  }

  function startTimer(item: Item) {
    item.startedAt = now();
    item.timer = timers.setTimeout(() => {
      item.timer = null;
      startCommit(item);
    }, item.remaining);
  }

  function startCommit(item: Item): Promise<void> {
    if (item.committing) return item.committing;
    stopTimer(item);
    item.committing = Promise.resolve()
      .then(() => commit(item.tabHash, pending))
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        // A cancel, and maybe a new removal of the same song, may have come in meanwhile; that one is left alone.
        if (items.get(item.tabHash) !== item) return;
        items.delete(item.tabHash);
        pending.delete(item.tabHash);
        changed();
      });
    changed();
    return item.committing;
  }

  function drop(tabHash: string): boolean {
    const item = items.get(tabHash);
    if (!item) return false;
    stopTimer(item);
    items.delete(tabHash);
    pending.delete(tabHash);
    changed();
    return true;
  }

  return {
    remove(entry) {
      if (items.has(entry.tabHash)) return false;
      const item: Item = { tabHash: entry.tabHash, entry, paused: false, timer: null, remaining: delay, startedAt: 0, committing: null };
      items.set(entry.tabHash, item);
      pending.add(entry.tabHash);
      if (!closing) startTimer(item);
      changed();
      return true;
    },

    undo: drop,
    cancel: drop,

    pause(tabHash) {
      const item = items.get(tabHash);
      if (!item || item.paused || item.committing) return;
      if (item.timer !== null) item.remaining = Math.max(0, item.remaining - (now() - item.startedAt));
      stopTimer(item);
      item.paused = true;
      changed();
    },

    resume(tabHash) {
      const item = items.get(tabHash);
      if (!item || !item.paused || item.committing) return;
      item.paused = false;
      if (!closing) startTimer(item);
      changed();
    },

    async commitAll() {
      await Promise.all([...items.values()].map(startCommit));
    },

    async dropEntriesAll() {
      closing = true;
      for (const item of items.values()) stopTimer(item);
      try {
        await dropEntries(pending);
      } catch {
        // the app is closing; a song left in the index shows again after restart
      }
    },

    pendingHashes: () => pending,
    items: () => shown,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * The stored files a commit is deleting right now, by hash (KTD3). A copy of one of them waits for its delete and then
 * copies afresh instead of trusting the "already stored" shortcut, which would otherwise find the file just before it goes.
 */
export interface DeleteGuard {
  /** Marks the file as being deleted; the function returned says its delete is over. */
  begin(hash: string): () => void;
  /** For `StoreOptions.forceCopy`: false at once when the file is not being deleted, else true once its delete is over. */
  forceCopy(hash: string): boolean | Promise<boolean>;
}

export function createDeleteGuard(): DeleteGuard {
  const deleting = new Map<string, Promise<void>>();
  return {
    begin(hash) {
      let done!: () => void;
      const mine = new Promise<void>((resolve) => (done = resolve));
      const before = deleting.get(hash);
      const all = before ? Promise.all([before, mine]).then(() => undefined) : mine;
      deleting.set(hash, all);
      void all.then(() => {
        if (deleting.get(hash) === all) deleting.delete(hash);
      });
      return done;
    },
    forceCopy(hash) {
      const busy = deleting.get(hash);
      return busy ? busy.then(() => true) : false;
    },
  };
}

/**
 * The store options for one library copy (KTD3): says the copy has started, so its hash joins the storing set before
 * the shell's exists check, then waits out any delete of the same file.
 */
export function guardedStore(deleting: DeleteGuard, storing: (hash: string) => void): StoreOptions {
  return {
    forceCopy(hash) {
      storing(hash);
      return deleting.forceCopy(hash);
    },
  };
}

export interface RemovalCommitDeps {
  /** Every in-flight library save has landed (the session's `settledAll`). */
  settledAll(): Promise<void>;
  commitRemoval(tabHash: string, context: RemovalContext): Promise<CommittedRemoval | null>;
  /** The session's live storing set. */
  storingHashes: ReadonlySet<string>;
  deleting: DeleteGuard;
  deleteFile(kind: LibraryKind, hash: string, extension: string): Promise<DeleteResult>;
}

/** How one committed removal went. `kept` means the step decided not to delete it; `in-use` and `failed` leave it for the sweep. */
export interface CommitOutcome {
  removal: CommittedRemoval;
  tab: DeleteResult | 'kept';
  /** Null when the song had no recording. */
  recording: DeleteResult | 'kept' | null;
}

/**
 * The commit for `createRemovals` (KTD2, KTD3): waits for every save, then removes the entry in one library step that
 * re-checks it is still pending, marks the files it will delete before writing the index, and deletes them. Null when
 * nothing was committed: the removal was cancelled, the song is gone, or the index could not be read or written.
 */
export function createRemovalCommit(deps: RemovalCommitDeps): (tabHash: string, pendingHashes: ReadonlySet<string>) => Promise<CommitOutcome | null> {
  return async (tabHash, pendingHashes) => {
    try {
      await deps.settledAll();
    } catch {
      // the step's own checks still hold
    }
    const ends = new Map<string, () => void>();
    try {
      const removal = await deps.commitRemoval(tabHash, {
        pendingHashes,
        storingHashes: deps.storingHashes,
        beforeWrite: ({ entry, deleteTab, deleteRecording }) => {
          if (deleteTab) ends.set(entry.tabHash, deps.deleting.begin(entry.tabHash));
          if (deleteRecording && entry.recording) ends.set(entry.recording.hash, deps.deleting.begin(entry.recording.hash));
        },
      });
      if (!removal) return null;
      const remove = async (wanted: boolean, kind: LibraryKind, hash: string, extension: string): Promise<DeleteResult | 'kept'> => {
        if (!wanted) return 'kept';
        try {
          return await deps.deleteFile(kind, hash, extension);
        } catch {
          return 'failed';
        } finally {
          ends.get(hash)?.();
          ends.delete(hash);
        }
      };
      const { entry, deleteTab, deleteRecording } = removal;
      const [tab, recording] = await Promise.all([
        remove(deleteTab, 'tab', entry.tabHash, TAB_EXTENSION),
        entry.recording ? remove(deleteRecording, 'recording', entry.recording.hash, entry.recording.extension) : Promise.resolve(null),
      ]);
      return { removal, tab, recording };
    } finally {
      // A step that marked files and then failed to write deletes nothing; copies waiting on it go ahead.
      for (const end of ends.values()) end();
    }
  };
}
