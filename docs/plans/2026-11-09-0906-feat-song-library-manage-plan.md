---
title: Song Library Manage - Plan
type: feat
date: 2026-11-09
topic: song-library-manage
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Song Library Manage - Plan

## Goal Capsule

- **Objective:** A desktop player can keep their song library tidy. They can rename songs, remove the ones they don't want (getting the disk space back, with a moment to undo), and see plainly when a song's files are missing or the library file couldn't be read.
- **Means:** A per-row menu in both song lists, a pending-removal list that commits after an undo window, shell delete and orphan-sweep commands, and a `customTitle` field (KTD1–KTD5).
- **Product authority:** RACE-001 (`docs/races/RACE-001-song-library.md`), the SPRINT-01 and SPRINT-02 plans (`docs/plans/2026-11-09-0603-feat-song-library-save-and-reopen-plan.md`, `docs/plans/2026-11-09-0755-feat-song-library-switch-songs-plan.md`) whose behaviour this keeps, and the Key Decisions below. Sprint tracking: `docs/sprints/RACE-001-SPRINT-03-manage-library.md`.
- **Stop conditions:** Stop and ask before adding a Tauri plugin, a Cargo feature, an npm dependency, or a capability or CSP change. Stop if a change could let the startup sweep delete a file named by a remaining entry, an unreadable entry or a set-aside index, or let a removal delete files other than its own entry's under R4.
- **Execution profile:** TypeScript page logic and React UI, plus Rust shell commands. Proof is Vitest, `cargo test`, and a manual pass on a packaged desktop build.
- **Tail ownership:** The implementer commits each unit on `feat/song-library` and stops there. Push and PR need the owner's approval.

---

## Product Contract

### Summary

Each row in the start-screen list and in the Songs menu gets a small menu with Rename and Remove. A rename sets a custom title that survives reopening. Removing a song hides it at once with an Undo notice for about 8 seconds. When the notice goes away, or the app closes, the entry, its stored tab and its copied recording are deleted, unless another song uses that recording. Rows show "Recording missing" or "Tab missing". The start screen says when the library file was set aside. Loading the same file again replaces a damaged stored copy.

### Problem Frame

SPRINT-01 saves every opened tab automatically, so the list fills with tabs the player only glanced at, and their copied recordings take disk space. There is no way to tidy it. A song whose files went missing only says so after it is opened. An unreadable library file is set aside, but the list just looks empty. A stored copy whose bytes changed is treated as missing, and loading the original again doesn't fix it, because the shell keeps the existing file.

### Requirements

**Rename**

- R1. Each song's row menu has Rename. The new name shows in both lists and survives restarts and reopening the song or loading the same file again. An empty name goes back to the tab's own title. Names are trimmed, kept to one line, and capped at 120 characters. Duplicate names are allowed.

**Remove**

- R2. Each song's row menu has Remove. The song disappears from both lists at once, and a notice "Removed <name>. Undo" shows for about 8 seconds. Each removal has its own notice and timer.
- R3. Undo puts the song back exactly as it was: title, setup, position, recording and video.
- R4. When the notice goes away, or the app closes, the removal commits:
  - the entry is deleted, and so is its stored tab;
  - its copied recording is deleted unless another song uses it, counting songs whose own removal is still pending and entries this version can't read.

  The player's original files and the stem audio are never touched.
- R5. Removing the open song leaves it as SPRINT-02 does. Removing a song that is still opening abandons the open first. Remove is disabled for the open song while a recording with video is being captured.
- R6. Opening a song, or loading a file, whose removal is still pending cancels that removal. The song keeps its setup.
- R7. Opening Back up and restore commits any pending removals first.

**Explaining problems**

- R8. When the list loads, a song whose stored recording is missing shows "Recording missing". A song whose stored tab is missing shows "Tab missing". A Tab missing row doesn't open; its menu offers only Remove, plus a hint that loading the original file again brings it back.
- R9. A song whose stored copy fails its hash check when opened is marked "Recording damaged" or "Tab damaged" for the rest of the session (KTD8).
- R10. When the library file couldn't be read at startup, the start screen shows a dismissible message that it was set aside, naming the file. New songs are saved normally.
- R11. Loading the same tab or recording again replaces a stored copy whose bytes don't match its hash, and the badge clears.

**Safety**

- R12. At startup, stored files that no index entry names are deleted. This only happens after the library file was read successfully. Files named in any set-aside library file, or in entries this version can't read, are kept. A second set-aside never overwrites an earlier one.
- R13. A removal that commits while a copy of the same recording is being written keeps that file.

### Key Decisions

- **Undo notice, not a confirm dialog.** (session-settled: user-directed — chosen over a "Remove 'Song'?" confirm dialog.) Governs R2, R3, R4.
- **Remove deletes the song and its recording copy unless another song shares it.** (session-settled: user-directed — chosen over removing the entry only, or also forgetting the recording's offset, mix and alignment.) Governs R4.
- **Stem audio is not deleted.** The engine has no delete API (a constraint, not a choice). Governs R4.
- **Startup clean-up of unreferenced files, only after a successful read.** (session-settled: user-approved.) Governs R12.
- **Missing shows at list load; damaged shows after a failed open.** (session-settled: user-approved — a cheap exists check rather than hashing every file.) Governs R8, R9.

### Acceptance Examples

- AE1. **Covers R1.** Given song A renamed "Warmup", when A is reopened and the same tab file is dropped again, then it still reads "Warmup".
- AE2. **Covers R4, R13.** Given A and B share recording R, when A is removed and its notice expires, then R stays. When B is then removed and expires, R is deleted.
- AE3. **Covers R6.** Given A's removal is pending, when the player drops A's tab file, then A opens with its setup and nothing is deleted when the notice would have expired.
- AE4. **Covers R12.** Given the library file was set aside, when the app restarts with a new index, then no file named in the set-aside file is deleted.
- AE5. **Covers R11.** Given A's stored recording was altered on disk, when the player loads the original recording file again, then the stored copy is replaced and A plays from the library.

### Scope Boundaries

- Deleting stem audio.
- Forgetting a recording's offset, mix and alignment.
- Bulk select, search, sort.
- Undo after a restart (pending removals commit at close).
- The web build.

#### Deferred to Follow-Up Work

- Deleting stems, once the engine offers a delete call.

### Sources

- Sprint: `docs/sprints/RACE-001-SPRINT-03-manage-library.md`. SPRINT-01 and SPRINT-02 plans and code on `feat/song-library` up to `486215a`.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Rename sets an optional `customTitle` on the entry.** `SongLibrary.open()` keeps refreshing `title` from the tab and never touches `customTitle`. `displayTitle` prefers `customTitle`. An empty rename deletes the field. Governs R1.
- KTD2. **A pending removal lives in memory, not in the index.**
  - The page keeps a list of pending removals: tab hash, entry snapshot, timer. Both lists filter those songs out.
  - Undo drops the pending item. The index was never changed, so R3 holds exactly, even if a late position write lands meanwhile.
  - Commit is one `SongLibrary.serial` step (KTD3):
    1. Re-check that the item is still pending; a cancel that arrived first wins (R6).
    2. Re-read the index and remove the entry.
    3. Delete the tab, and the recording only when no remaining or pending entry names its hash, and its hash appears nowhere in an unreadable entry's serialized JSON.
  - Opening a song or file whose hash is pending cancels the item (R6).
  - The window-close handler first runs one `SongLibrary.serial` step that removes every pending entry. That step doesn't wait on in-flight saves and skips the shell deletes. The startup sweep (KTD4) then deletes the now-unreferenced files. This keeps close inside the existing 1.5-second cap. If even that index write is cut off, the song shows again after restart.
  - Opening Back up and restore starts `commitAll`. The dialog's Create and Restore buttons stay disabled until it resolves (R7).

  Governs R2–R7.
- KTD3. **The shell gets `library_delete(kind, hash, extension)`.**
  - It validates names with the existing `file_path_for`.
  - It refuses, and keeps the file, while a `Writes` handle for the same target is open (R13). Finishing a write and deleting share the `Writes` lock, so neither can slip between the other's check and its action.
  - A file that is already missing counts as success.
  - A session-wide guard on the page covers the `store()` exists shortcut, which never opens a `Writes` handle:
    - The page keeps a *storing* set: a hash is added when `store()` starts and dropped once the entry write naming it settles. It also keeps a *deleting* set.
    - A commit awaits `settledAll()` (every in-flight save, not one song's).
    - In the same `SongLibrary.serial` step, the commit re-reads the index, checks references, writes the index and issues the shell deletes. It skips any hash in the storing set.
    - `store()` for a hash in the deleting set waits for that delete, then skips the exists shortcut.
  - `Writes::finish` holds the `open` lock through its exists check, the KTD6 re-hash and the rename, so a delete can't slip between them. A large re-hash briefly blocks other library commands; that is accepted.

  Governs R4, R13.
- KTD4. **The orphan sweep runs in the shell at startup, in `main()` next to `sweep_temp`, before the page can write.** It reads `library.json` with `fs::read` and `parse_index`. It must not use `read_index`, which renames a bad index and would steal the page's quarantine flag. It skips the sweep entirely on any read or parse failure. It considers only names of the form `<64hex>.<allowed ext>` in `tabs/` and `recordings/`, and deletes stored files whose 64-hex hash:
  - doesn't appear anywhere in `library.json`'s raw text, so unknown fields and unreadable entries still protect their files;
  - doesn't appear in any `library.json.bad*` or `library.json.bak` file (the restore's copy of the previous index), all scanned as raw text;

  and that are:
  - older than the shell's start time.

  It never runs mid-session, so a restore can't race it. Governs R12.
- KTD5. **Quarantine never overwrites an earlier set-aside, and the flag lasts the session.**
  - A second unreadable index is set aside as `library.json.bad-<n>`.
  - The flag is one-shot from the shell, and the profile keep-set's early `library.list()` can use it up. So `SongLibrary` latches `quarantined` from any read for the rest of the session and exposes a getter for the start-screen message.

  Governs R10, R12.
- KTD6. **A damaged existing copy is replaced on finish.** `Writes::finish` re-hashes an existing target before keeping it. On a mismatch it replaces the target with the new temp file through a rename. If Windows refuses the rename because the file is open for reading, it reports an error, and the page keeps the song as damaged.
  - On the page, `store()` returns early when the file exists, so it never reaches `finish`. It skips that shortcut for a hash in the session's damaged set.
  - Repairing a damaged copy through a backup restore is out of scope (`backup.rs` also keeps an existing target).

  Governs R11.
- KTD7. **File checks at list load use the existing `library_exists`.** It runs for the tab and the recording, in parallel per song. Hash mismatches found by `readTab` and `readRecording` on open are recorded in a session-only damaged set the lists read. A read now reports missing and damaged separately: missing when the file doesn't exist, damaged when the hash doesn't match. Governs R8, R9.
- KTD8. **The row menu is a small `Menu` beside the row button, not inside it, to avoid nested buttons.** Rename swaps the row title for an input: Enter saves, Escape cancels, blur saves.   - `Menu` closes on any button click inside its panel, and every `Menu` closes on Escape. Nested inside the Songs menu, an inner Rename or Remove click would close both.
  - `Menu` therefore gains a keep-open opt-out, so the inner panel's clicks don't reach the outer one. Escape closes only the innermost open menu.
  - Undo state lives in App, because the Songs menu's rows unmount when it closes.
  - Rename input:
    - Escape cancels the edit and stops the keydown from reaching any `Menu` listener.
    - An edit in progress is saved explicitly when the Songs menu closes, not through an unmount blur.
    - Focus returns to the row's menu button after a save or cancel.
  - Each row menu is labelled "Actions for <name>". After Remove, focus moves to the next row, then the previous one, then the list heading.
  - Damaged songs show "Recording damaged" or "Tab damaged":
    - A damaged-recording row still opens, and plays with the R13 note.
    - A damaged-tab row behaves like Tab missing.
    - Both menus carry the hint "Load the original file again to repair it".
  - Undo notices:
    - They sit in one `role="status"` stack: under the action buttons on the start screen, and under the player status line in the player.
    - At most 3 show, newest first. Older ones still run their timers.
    - Hovering or focusing a notice pauses its timer.
  - Row and menu availability:

    | State | Open song row / Rename / Remove | Other rows / Rename / Remove |
    |---|---|---|
    | Idle | n/a (start screen) or marked / yes / yes | yes / yes / yes |
    | A song opening | row marked opening / yes / yes (abandons the open, R5) | yes / yes / yes |
    | A file opening (start screen) | — | row disabled / yes / yes |
    | Recording with video | marked / yes / no (R5) | disabled by the lock / yes / yes |


  Governs R1, R2, R8.

---

## Implementation Units

### U1. Shell: delete, sweep, quarantine naming, damaged replace

- **Goal:** The shell can delete stored files safely, sweep orphans at startup, keep every set-aside index, and replace damaged copies.
- **Requirements:** R4, R10–R13 (KTD3–KTD6)
- **Dependencies:** none
- **Files:** `src-tauri/src/library.rs`, `src-tauri/src/main.rs`
- **Approach:**
  - Add `delete` (KTD3) and the orphan sweep, called from `main()` next to `sweep_temp` (KTD4).
  - Add `.bad-<n>` naming (KTD5) and the re-hash on finish (KTD6). The sweep is called from `main()`, not from `read_index`.
  - Register `library_delete` in the command list.
- **Patterns to follow:** existing `Writes`, `file_path_for`, `sweep_temp` and the scratch-directory tests in `library.rs`.
- **Test scenarios:**
  - Delete removes a stored recording. A missing file counts as success. A bad hash or extension is refused.
  - Delete is refused while a write to the same target is open, and succeeds once it finishes.
  - The sweep deletes an unreferenced old file, and keeps referenced files, files named in `library.json.bad`, `.bad-2` or `library.json.bak`, files whose hash appears only under an unknown field in `library.json`, files newer than start, and temp files.
  - No sweep runs after a quarantining read.
  - A second unreadable index becomes `library.json.bad-2` and keeps `.bad`.
  - Finish onto a damaged target replaces it. Finish onto a good target keeps it.
- **Verification:** `cargo test` passes.

### U2. Library model: rename, remove, quarantine flag, file checks

- **Goal:** The page model supports rename, committing a removal, the session quarantine flag, and missing/damaged file state.
- **Requirements:** R1, R4, R8–R10 (KTD1, KTD2, KTD5, KTD7)
- **Dependencies:** U1
- **Files:** `src/app/library.ts`, `src/app/library-shell.ts`, `tests/app/library.test.ts`, `tests/app/library-shell.test.ts`
- **Approach:**
  - Add `customTitle` validation, `rename(tabHash, title)` and `displayTitle` precedence.
  - Add `commitRemoval(tabHash, keepRecordingHashes)`. It returns which files to delete: the tab always, and the recording only when no other readable or unreadable entry, and no pending removal, names its hash.
  - The backend remembers `quarantined` for the session.
  - `readTab`/`readRecording` return `missing` or `damaged` reasons.
  - `store()` skips the exists shortcut for a hash in the damaged set (KTD6).
  - Add a `checkFiles(entry)` helper.
- **Test scenarios:**
  - Covers AE1. A rename survives `open()` with a new tab title. An empty rename restores the tab title. Input is trimmed and capped at 120.
  - Covers AE2. With a shared recording, the first commit keeps it and the second deletes it.
  - A pending removal counts as a user of the recording. An unreadable entry naming the hash under any field keeps it.
  - The quarantine flag survives a second read in the same session.
  - `checkFiles` reports tab missing, recording missing, or both.
  - A hash-mismatch read reports `damaged`, and a missing file reports `missing`.
- **Verification:** The tests pass.

### U3. Pending removals and their commits

- **Goal:** Remove, undo, cancel-on-open and commit-on-expiry, close and backup work end to end in the app.
- **Requirements:** R2–R7 (KTD2)
- **Dependencies:** U2
- **Files:** `src/app/library-removals.ts` (new, pure), `src/app/library-session.ts` (`settledAll`, storing set), `src/app/library-shell.ts`, `src/app/App.tsx`, `src/app/BackupDialog.tsx`, `src/app/window-close.ts`, `tests/app/library-removals.test.ts` (new), `tests/app/library-session.test.ts`, `tests/app/window-close.test.ts`
- **Approach:**
  - A pure `createRemovals` holds items and timers, and exposes:
    - `remove(entry)`, `undo(tabHash)` and `cancel(tabHash)`;
    - `commitAll()` and `pendingHashes()`.

    Commit calls `commitRemoval` and then the shell delete.
  - App wiring:
    - Removing the open song calls `leaveSong`, and removing an opening song invalidates the reopen first.
    - `onFile` and `onReopen` cancel a pending removal of the same hash.
    - Opening Back up and restore calls `commitAll`.
    - The close handler commits within the cap.
    - The RECORDING_NOT_SAVED note never shows for a removed song.
- **Test scenarios:**
  - Remove, then undo, commits nothing and leaves the index unchanged (R3).
  - Expiry after about 8 s commits. Two removals have independent timers.
  - Cancel on reopen commits nothing (AE3).
  - `commitAll` commits everything pending at once (backup, close).
  - A commit while the same recording is being written keeps the file. The shell refuses, and the page treats it as kept.
  - B loads recording R through the exists shortcut while A's removal of R commits: R survives and B names it.
  - A cancel that arrives after the expiry fired but before the commit's serial step leaves the entry untouched.
  - Close removes pending entries even when `settledAll` hangs past the cap.
  - The backup dialog's buttons stay disabled until `commitAll` resolves.
  - The close handler commits pending removals and still calls `app_close_ready` when a commit hangs past the cap.
- **Verification:** The tests pass. Manual remove, undo and expiry on desktop.

### U4. Row menu, rename input, badges and messages

- **Goal:** The UI for everything above in both lists.
- **Requirements:** R1, R2, R5, R8–R10 (KTD7, KTD8)
- **Dependencies:** U3
- **Files:** `src/app/LibraryList.tsx`, `src/app/Menu.tsx`, `src/app/DropZone.tsx`, `src/app/App.tsx`, `src/app/app.css`, `tests/app/library-list.test.ts`, `tests/app/menu.test.ts`
- **Approach:**
  - Each row gets a "⋯" `Menu` beside it with Rename and Remove. Rename shows an inline input.
  - Badges are read from the file-check state and the session damaged set. A Tab missing row is inert, and its menu has Remove only plus the hint.
  - Remove is disabled for the open song under the recording lock.
  - Undo notices go in one stacked `role="status"` area on the start screen and in the player.
  - The set-aside message sits on the start screen, dismissible.
- **Patterns to follow:** the existing `Menu`, `LibraryList` notice slot and `libraryNote` notice.
- **Test scenarios:**
  - Each row renders its menu outside the row button.
  - An inner row-menu click doesn't close the Songs menu, and Escape closes only the inner menu.
  - Rename input: Enter, Escape and blur, 120-character cap. Escape in the input leaves the Songs menu open. Closing the menu mid-edit saves it.
  - The row menu label names the song. Focus moves to the next row after Remove.
  - Damaged badges and hint render.
  - The notice stack caps at 3, and hover/focus pauses the timer.
  - The availability table holds for each state.
  - Badges render for missing tab, missing recording and damaged.
  - A Tab missing row is not clickable and its menu offers only Remove.
  - The undo notice renders with the song name, and pressing Undo calls `undo`.
  - The set-aside message renders when quarantined.
  - Remove is disabled for the current song under the record lock.
- **Verification:** Tests pass. A code-level layout check at the 720px minimum width.

---

## Verification Contract

| Gate | Command or procedure | Applies to |
|---|---|---|
| Unit tests | `npm test` | U2–U4 |
| Typecheck and build | `npm run typecheck`, `npm run build` | page units |
| Rust tests | `cargo test` in `src-tauri/` | U1 |
| Manual: rename and remove | Packaged desktop build. Rename and restart (AE1). Remove and undo. Remove and let expire, then check `data/library/` sizes. Shared recording (AE2). Remove the open song. Remove, then drop the same file (AE3) | U3, U4 |
| Manual: problems | Delete a stored recording, then the list shows Recording missing. Alter one, then open, see damaged, and reload the original to replace it (AE5). Corrupt `library.json`, then the message shows. Restart, then nothing named in `.bad` is deleted (AE4) | U1, U2, U4 |
| Manual: close and backup | Remove, then close at once, then reopen: the files are gone. Remove, then open Back up and restore: the removal commits first | U3 |

Record results in the sprint's evidence table.

---

## Definition of Done

- R1–R13 are each met and checked by a test or a recorded manual procedure.
- Every Verification Contract gate has a recorded result. A check that couldn't run is marked blocked, not passed.
- The startup sweep never deletes a file named by a remaining entry, an unreadable entry, or a set-aside index (`library.json.bad*`, `library.json.bak`). A committed removal deletes only its own entry's files under R4.
- No new plugin, Cargo feature, npm dependency, capability or CSP change.
- The SPRINT-01 and SPRINT-02 tests still pass.
- Abandoned approaches and debugging code are removed.
