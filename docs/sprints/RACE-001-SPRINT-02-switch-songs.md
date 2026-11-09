# RACE-001-SPRINT-02: Switch songs from inside a song

Race: [RACE-001 Song library](../races/RACE-001-song-library.md)
Status: verifying
Owner: epeterson0076
Execution plan: [Song Library Switch Songs - Plan](../plans/2026-11-09-0755-feat-song-library-switch-songs-plan.md) (canonical requirements R1–R11, AE1–AE5, units U1–U5)

## Outcome and boundaries

Deliver: on desktop, a "Songs" menu in the player opens the saved-songs list. Picking a song leaves the current one with its state saved and opens the new one restored. Coming back to a song resumes at the bar you left off at.
Current behavior: switching means "More → Open another file" back to the start screen, then picking from "Your songs" (SPRINT-01). Setup changes are saved as they happen. Reopening restores the backing track and setup but always starts at the top.
In scope: the player's Songs menu, cleanly leaving the current song (stop playback, release recording, stems and video, let pending library saves finish), and saving and restoring the playback position.
Non-goals: "back to last song" and next/previous shortcuts (not chosen). Rename and remove (SPRINT-03). Remembering loop or tempo. The web build.
Dependencies: SPRINT-01 (commits 20ad73d..e2e879e on `feat/song-library`).

## Acceptance criteria

Moved to the execution plan (R1–R11, AE1–AE5). Mapping: AC-01 → R1; AC-02 → R2, R5; AC-03 → R5, AE2; AC-04 → R7, R8, AE1; AC-05 → R5; AC-06 → R11; AC-07 → R10, AE4; AC-08 → R9. Added by planning: R3 (same song), R4 (recording and stem-separation guards), R6 (what counts as leaving), AE3 (holds), AE5 (window close).

## Authority for this sprint

- Allowed: local inspection, edits, `npm test`, `npm run typecheck`, `cargo test`, local builds, and commits per unit on `feat/song-library` (as in SPRINT-01).
- Requires separate approval: push, PR, installer builds for distribution, new dependencies or Tauri plugins.

## Checkpoints

| Gate | Evidence required | Status |
|---|---|---|
| C0 Ready | Scope and acceptance criteria agreed; plan written | done (plan 2026-11-09-0755) |
| C1 Implemented | Songs menu, clean leave, position save and restore present | done (U1–U5, commits 374f9d3..486215a) |
| C2 Verified | Evidence table filled | pending |
| C3 Reviewed | `ce-code-review` findings resolved or recorded | done: 7 reviewers; fixes in 486215a; remaining items under Closeout |
| C4 Closed | Race table updated; lesson considered | pending |

## Verification evidence

| Requirement | Check/command or manual procedure | Actual result | Evidence reference | Limitation |
|---|---|---|---|---|
| R1, R3, R4 | Vitest (list, menu guards); manual on desktop | automated passed; manual not run | 486215a: `npm test` 1931 passed, 5 skipped | Needs packaged build |
| R2, R5, R6, R11, AE1, AE2 | Vitest (leave plan, settled); manual switch | automated passed (pure helpers); manual not run | 486215a | App wiring has no renderer test |
| R7–R9, AE3 | Vitest (position, resume seek); manual with a hold | automated passed, including a real recording clock with a 2 s offset and a hold; manual not run | 486215a | Synth and YouTube seek timing need a desktop run |
| R10, AE4 | Vitest; manual with a deleted tab | automated passed; manual not run | 486215a | |
| AE5 | `cargo test`, Vitest; manual close and reopen | automated passed: `cargo test` 117 passed; manual not run | 486215a | Needs packaged build |

Gates and procedures: the plan's Verification Contract.

## Scope changes and blockers

| Date | Proposed change or blocker | Impact | Decision/owner |
|---|---|---|---|
| 2026-11-09 | Resume position: chosen over starting from the top | Adds a position field to the song | epeterson0076 |
| 2026-11-09 | Stem separation during a switch: warn, then switch (chosen over blocking or background separation) | Adds a warning line | epeterson0076 |
| 2026-11-09 | Switcher: Songs menu only; "back to last song" and next/previous shortcuts not chosen | Narrows scope | epeterson0076 |

## Closeout

Completed requirements: —
Incomplete requirements: —
Review findings: —
Residual risk: —
Lesson: —
Next action: run the manual checks in the plan's Verification Contract on a packaged desktop build and fill in this table.

Known limits and deferred review items (not blocking):
- Between releasing a song and the next one opening, the old song stays on screen paused without its recording; pressing play in that moment plays its built-in sound until the new song opens.
- The left song's video is paused, not detached, until the next tab opens.
- Songs-menu rows stay enabled while a dropped file is opening; whichever finishes last is shown.
- If the shell's close event can't be listened to, closing falls back after 2 s without saving the position (no message).
- No renderer-level tests for App wiring; library state could move out of `App.tsx` into a hook.
