# RACE-001-SPRINT-01: Save and reopen songs

Race: [RACE-001 Song library](../races/RACE-001-song-library.md)
Status: verifying
Owner: epeterson0076
Execution plan: [Song Library Save and Reopen - Plan](../plans/2026-11-09-0603-feat-song-library-save-and-reopen-plan.md) (canonical requirements R1–R17, AE1–AE4, units U1–U5)

## Outcome and boundaries

Deliver: on desktop, every tab you open is saved as a song; the start screen lists saved songs; opening one restores the tab, its backing track already loaded, and its setup.
Current behavior: tab files aren't stored (`src/app/App.tsx` `onFile`); recording setup returns only when the same file is dropped again; the start screen (`src/app/DropZone.tsx`) offers drop, sample and backup.
In scope: library store in the shell under `data/library/`, saving the tab and backing track, the start-screen list, restore on open, and adding the library to backups.
Non-goals: switching songs from inside a song (SPRINT-02), rename/remove (SPRINT-03), the web build, restoring loop or tempo.
Dependencies: none. Decided 2026-11-09: a loaded recording is copied (not moved) into `data/library/`; separated songs reuse their saved stems.

## Acceptance criteria

Moved to the execution plan: requirements R1–R17 and acceptance examples AE1–AE4. Mapping from the original criteria:

| Original | Now |
|---|---|
| AC-01 | R1, R7 |
| AC-02 | R3, R8 |
| AC-03 | R9 |
| AC-04 | R4, R10 |
| AC-05 | R6, R8 |
| AC-06 | R2, R5, R11 (now keyed by tab file contents, not fingerprint; AE1) |
| AC-07 | R12, R13 |
| AC-08 | R16 (recordings included; stems excluded; AE4) |
| AC-09 | R17 |

Added by planning: R14 (failed copy), R15 (superseded reopen).

## Authority for this sprint

- Allowed: local inspection, edits, `npm test`, `npm run typecheck`, `cargo test`, local desktop builds.
- Requires separate approval: commits, push, PR, installer builds for distribution, new dependencies or Tauri plugins.
- Data: test with your own song files; don't commit them (`dev/local/` is ignored).

## Checkpoints

| Gate | Evidence required | Status |
|---|---|---|
| C0 Ready | Recording-storage decision made; plan written or this doc confirmed as canonical | done (plan 2026-11-09-0603) |
| C1 Implemented | Library store, start-screen list, restore path present | done (U1–U5, commits 20ad73d..e2e879e) |
| C2 Verified | Evidence table filled | pending |
| C3 Reviewed | `ce-code-review` findings resolved or recorded | done: 7 reviewers; fixes in e2e879e; remaining items recorded in Closeout |
| C4 Closed | Race table updated; lesson considered | pending |

## Verification evidence

| Requirement | Check/command or manual procedure | Actual result | Evidence reference | Limitation |
|---|---|---|---|---|
| R1–R7, AE1 | `npm test` (library model, save hooks) | passed (automated): 1835 passed, 5 skipped; typecheck clean | branch feat/song-library @ e2e879e | App wiring has no component tests; manual desktop check still needed |
| R8–R11, AE2 | Manual reopen on packaged build | not run (restore logic unit-tested in library-restore and youtube-wiring tests) | | Needs packaged desktop build |
| R12–R15, AE3 | `cargo test`, Vitest, manual failure checks | automated passed: `cargo test` 116 passed; manual not run | e2e879e | Kill-during-copy and corrupt-index checks need a packaged build |
| R16, AE4 | `cargo test` (backup), manual restore into empty folder | automated passed (60 MB round-trip, merge tests); manual not run | e2e879e | Window responsiveness, backup time and memory unmeasured |
| R17 | Browser dev run | partly: unit tests confirm no library on web; `npm run build` passed; browser run not done | e2e879e | |
| Measurement | 10-minute WAV save and reopen: time, peak memory | not run | | Needs packaged build |

Gates and procedures: the plan's Verification Contract.

## Scope changes and blockers

| Date | Proposed change or blocker | Impact | Decision/owner |
|---|---|---|---|
| 2026-11-09 | Recording storage: copy into `data/library/` vs store a path | Unblocked C0 | Copy into `data/library/` — epeterson0076 |

## Closeout

Completed requirements: —
Incomplete requirements: —
Review findings: —
Residual risk: —
Lesson: —
Next action: run the manual checks in the plan's Verification Contract on a packaged desktop build and fill in this table.

Deferred review items (not blocking): move library state out of `App.tsx` into a `useSongLibrary` hook; show a message when the library index was set aside; repair a stored copy whose bytes no longer match its hash; guard against a second app instance sweeping the first one's temp files.
