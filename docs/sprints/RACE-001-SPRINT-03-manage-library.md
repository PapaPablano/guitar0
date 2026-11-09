# RACE-001-SPRINT-03: Manage the library

Race: [RACE-001 Song library](../races/RACE-001-song-library.md)
Status: verifying
Owner: epeterson0076
Execution plan: [Song Library Manage - Plan](../plans/2026-11-09-0906-feat-song-library-manage-plan.md) (canonical requirements R1–R13, AE1–AE5, units U1–U4)

## Outcome and boundaries

Deliver: on desktop, each saved song can be renamed or removed from the start screen list and the Songs menu. Removing frees the disk space its stored tab and copied recording used, with a short undo. Songs whose files are missing or damaged, and a library file that couldn't be read, are explained in the list instead of failing silently.
Current behavior:
- Songs can't be renamed or removed.
- A missing recording shows a note only after opening (SPRINT-01 R13).
- An unreadable `library.json` is set aside as `library.json.bad`, but the list just shows empty.
- A stored copy whose bytes no longer match its hash reads as missing, and loading the same file again doesn't replace it.

In scope:
- Rename: changes the shown title only.
- Remove, with undo. It deletes the entry, the stored tab, and the copied recording unless another song uses it.
- Missing/damaged badges in the lists.
- The set-aside library message.
- Repairing a damaged stored copy when the same file is loaded again.

Non-goals:
- Deleting stem audio (the engine has no delete API).
- Forgetting a recording's offset, mix and alignment.
- Bulk select.
- Search or sort options.
- The web build.

Dependencies: SPRINT-01 and SPRINT-02 (on `feat/song-library` up to `486215a`).

## Acceptance criteria

Moved to the execution plan (R1–R13, AE1–AE5). Mapping: AC-01 → R1, AE1; AC-02 → R2; AC-03 → R3; AC-04 → R4, AE2; AC-05 → R5; AC-06 → R8, R9 (damaged shows after a failed open); AC-07 → R8; AC-08 → R10; AC-09 → R11, AE5 (tabs too); AC-10 → R7, backup behaviour unchanged. Added by planning: R6 (reopen cancels a pending removal), R12 (safe startup clean-up, AE4), R13 (no delete during a write).

## Authority for this sprint

- Allowed: local inspection, edits, `npm test`, `npm run typecheck`, `cargo test`, local builds, and commits per unit on `feat/song-library`.
- Requires separate approval: push, PR, installer builds for distribution, new dependencies or Tauri plugins.

## Checkpoints

| Gate | Evidence required | Status |
|---|---|---|
| C0 Ready | Scope and acceptance criteria agreed; plan written | done (plan 2026-11-09-0906) |
| C1 Implemented | Rename, remove with undo, badges, set-aside message, copy repair present | done (U1–U4, commits 604dad0..4e8708f) |
| C2 Verified | Evidence table filled | pending |
| C3 Reviewed | `ce-code-review` findings resolved or recorded | done: 7 reviewers; fixes in 4e8708f; remaining items under Closeout |
| C4 Closed | Race table updated; lesson considered | pending |

## Verification evidence

| Requirement | Check/command or manual procedure | Actual result | Evidence reference | Limitation |
|---|---|---|---|---|
| AC-01 | Vitest (rename, empty name); manual restart | automated passed; manual not run | 4e8708f: `npm test` 2044 passed, 5 skipped | |
| AC-02–AC-05 | Vitest (undo timing, shared-recording check, open-song removal); `cargo test` (delete commands); manual | automated passed, including the remove-again-after-undo race and the save/delete race; manual not run | 4e8708f; `cargo test` 124 passed | Real file deletion and close timing need a packaged build |
| AC-06, AC-07 | Vitest (file checks per row) | automated passed; manual not run | 4e8708f | |
| AC-08 | Vitest (quarantined flag shown) | automated passed; manual not run | 4e8708f | |
| AC-09 | `cargo test` (replace damaged copy); Vitest | automated passed; manual not run | 4e8708f | Windows may refuse the replace while the file is open |
| AC-10 | `cargo test` (backup restore after removal) | covered by the unchanged SPRINT-01 restore tests and the sweep keeping `.bak` names; manual not run | 4e8708f | |

## Scope changes and blockers

| Date | Proposed change or blocker | Impact | Decision/owner |
|---|---|---|---|
| 2026-11-09 | Remove guard: undo for a few seconds, chosen over a confirm dialog | Deletion is delayed until the notice goes away | epeterson0076 |
| 2026-11-09 | Remove deletes the song plus its recording copy (unless shared); chosen over entry-only or also forgetting settings | Frees disk space; settings kept | epeterson0076 |
| 2026-11-09 | Stem audio not deleted: the engine has no delete API | Stems still use disk space | Constraint |

## Closeout

Completed requirements: —
Incomplete requirements: —
Review findings: —
Residual risk: —
Lesson: —
Next action: run the manual checks in the plan's Verification Contract on a packaged desktop build and fill in this table.

Known limits and deferred review items (not blocking):
- Removing a song deletes its own files even if an old `library.json.bak` or `.bad` still names them (by design: only the startup clean-up honours those files). Conversely, files named in old `.bak`/`.bad` copies are never cleaned up, so some disk space can stay used after restores.
- No single-instance guard: running two copies of the app at once can let one delete a file the other just saved.
- Replacing a large damaged recording briefly blocks other library writes while it is re-hashed.
- Removing the open song from the Songs menu loses keyboard focus; removing the last start-screen song leaves nothing to focus.
- No renderer-level tests for App wiring; library state could move out of `App.tsx` into a hook.
- Stem audio is not deleted (no engine API).
