# RACE-001: Song library

Status: active
Owner: epeterson0076
Updated: 2026-11-09

## Outcome

A desktop player can reopen any song they practised before from a library of saved songs, and switch between songs mid-session, with the tab, its backing track and all its setup already loaded. This removes having to find and drop the tab and recording again on every visit.

## Success evidence

- Close the desktop app with two songs worked on (one with a recording and stems, one with a YouTube video); reopen it; open each from the library. Each comes back with its backing track loaded and its offset, alignment, sections, mix, track and tuning as left. Checked by hand on a packaged desktop build and recorded in the sprint evidence tables.
- From inside song A, open song B from the library, then return to A: A's backing track is still loaded and its setup unchanged.
- Baseline (observed 2026-11-09): no library. Tab files are never stored (`src/app/App.tsx` `onFile`). A recording's setup returns only after the same file is dropped again (keyed by content hash, `src/audio/recording-profile.ts`, `src/stems/saved-stems.ts`). YouTube video choice is remembered per tab fingerprint (`src/app/youtube-video-store.ts`).

## Scope and non-goals

In scope:
- Desktop (Tauri) build only.
- Saving a song when its tab is opened: the tab file, and the backing track once one is loaded (recording, stems, or YouTube video).
- A library list on the start screen, and a way to open it from inside a song.
- Restoring the full setup: backing track loaded, offset, alignment, sections, stem mix, chosen track, tuning.
- Leaving a song saves its current state, so coming back restores it.

Not in this race:
- The web site (stays drop-a-file).
- Syncing libraries between machines or accounts.
- Downloading YouTube audio (product commitment: the video plays in YouTube's player only).
- Restoring loop or tempo (deliberately not remembered per recording, R19 in the profile plan).
- Faster switching between instrument tracks within one song, or jumping to named sections (possible later races).

## Constraints and consequential decisions

- **Recording storage (decided 2026-11-09, owner):** when a recording is loaded as a song's backing track, the app copies it into `data/library/` (a reusable area), written in chunks the way exports are (`src-tauri/src/exports.rs`). It copies rather than moves: the page receives the file's contents without its path, and the user's original stays where it is. Cost: disk use roughly equal to the recordings. Revisit (e.g. a file picker that stores a path) only if disk use becomes a complaint.
- Reuse existing per-recording state (profiles, alignment files, stem index, YouTube store) instead of duplicating it in the library entry. The entry holds the tab, the backing-track reference, and session-only state that isn't stored yet (chosen track, tuning).
- `data/` survives rebuilds (durable-alignment-memory plan R1). The library must live under `data/` and be included in backups (`src-tauri/src/backup.rs`).
- Every store access is guarded: an unreadable library reads as empty and never blocks opening a file the normal way.

## Sprint sequence

| Sprint | Coherent deliverable | Dependency | Status | Canonical artifact |
|---|---|---|---|---|
| SPRINT-01 | Saved songs reopen from the start screen with tab, backing track and setup restored | none | verifying | [RACE-001-SPRINT-01](../sprints/RACE-001-SPRINT-01-save-and-reopen.md), [plan](../plans/2026-11-09-0603-feat-song-library-save-and-reopen-plan.md) |
| SPRINT-02 | Switch songs from inside a song; leaving saves state, returning restores it (including position) | SPRINT-01 | verifying | [RACE-001-SPRINT-02](../sprints/RACE-001-SPRINT-02-switch-songs.md) |
| SPRINT-03 | Manage the library: rename, remove (frees disk), missing or unreadable entries explained | SPRINT-01 | verifying | [RACE-001-SPRINT-03](../sprints/RACE-001-SPRINT-03-manage-library.md) |

Only SPRINT-01 is specified in detail.

## Race exit criteria

- [ ] SPRINT-01–03 outcomes delivered and verified.
- [ ] End-to-end check (Success evidence above) passed on a packaged desktop build, not just in tests.
- [ ] Library included in backup and restore, and survives a rebuild.
- [ ] Residual risks accepted by owner.

## Risks and open decisions

| Item | Consequence | Evidence needed | Owner | Blocks what? |
|---|---|---|---|---|
| Copying large recordings (WAV, long takes) over the page→shell bridge | Slow save or memory spike | Measure a 10-minute WAV save during SPRINT-01 | implementer | SPRINT-01 |
| Library entry vs existing stores drift (e.g. stems removed by engine) | Song opens without stems | Reuse `SavedStems.find`, which already drops missing jobs | implementer | SPRINT-01 |
| Should the library be Pro-gated? (Pro gating currently off) | Pricing scope | Owner decision | epeterson0076 | none now |

## Closeout

Result: —
Evidence: —
Remaining work: —
Reusable lessons: —
