---
title: Align Start To First Sound - Plan
type: fix
date: 2026-10-28
topic: align-start-to-first-sound
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Align Start To First Sound - Plan

## Goal Capsule

- **Objective:** A guitarist who loads a recording of a song that starts right away finds the tab and the recording starting together, not the tab running ahead of the first sound.
- **Means:** After the match, when it places bar 1 before the recording starts although both the recording and the tab begin sounding at once, move the timeline so bar 1 sits on the recording's first sound, if its own evidence holds (KTD1, KTD2).
- **Product authority:** The user. Always pinning the start, a manual "Start together" button, and recordings with an intro the tab lacks are not active scope.
- **Open blockers:** None.
- **Execution profile:** Code. The start check as pure functions first (U1), then its use in the matcher (U2), then the readout (U3). Done means the Definition of Done holds and the Creep recording lines up with bar 1 at its first sound.
- **Tail ownership:** The implementer runs the work through local verification. Committing and opening a PR happen only when the user asks.

**Product Contract preservation:** Product Contract is new; there was no upstream brainstorm file.

---

## Product Contract

### Summary

Auto-alignment sometimes puts bar 1 a beat or more before the recording begins, so the tab runs alone first and the sound arrives late. The fix applies only when three things hold: the match puts bar 1 before the recording, the recording sounds from its first second, and the tab's first notes are at its very start. It then looks for bar 1 near the recording's first sound, re-checks the rest of the timeline, and keeps the correction only if it holds. The alignment readout says when it did this.

### Problem Frame

For the Radiohead Creep recording, the tab's rhythm guitar, bass and drums all sound at tick 0, and the recording's first sound is at about 0.09 s. The match placed bar 1 at −0.56 s on the whole band and −0.9 s on the track on screen. The app then counts that long on its own before starting the recording, which is the pause the user hears. Repeating chord patterns make a start one beat early look nearly as good as the true one.

### Key Decisions

- KD1. **Fix only the negative-start case; do not always trust the start.** (session-settled: user-directed — chosen over always pinning bar 1 to the recording's start whenever it sounds from the beginning, and over a manual "Start together" button: recordings with a real intro must be untouched.) Governs R1, R2, R4.
- KD2. **The readout says when the start was corrected.** (session-settled: user-approved — chosen over a silent correction, consistent with the readout that already names the reference used.) Governs R3.

### Requirements

**When it applies**
- R1. The correction applies only when all three hold: the line-up puts bar 1 before the start of the recording by more than a short margin but less than one bar (a recording that really starts a bar or more into the song looks the same and is left as matched), the recording has sound within its first second, and the tab's render has sound within its first half second.
- R2. Otherwise the line-up is exactly as before, including recordings with an intro the tab lacks and any bar 1 at or after the recording's start.

**What it does**
- R3. When it applies, bar 1 is placed at the recording's first sound, refined on the note onsets where they support it, and every later bar moves by the same amount. The corrected line-up is kept only if it passes the same consistency check as any timeline and bar 1's onset evidence is no weaker than at the old position; otherwise the original result stands.
- R4. After a correction the readout says that bar 1 was set to the recording's first sound.

### Acceptance Examples

- AE1. **Covers R1, R3.** Given a recording that sounds at 0.09 s, a tab whose notes start at its start, and a match that puts bar 1 at −0.56 s, the line-up puts bar 1 at about 0.09 s and the later bars keep their spacing.
- AE2. **Covers R2.** Given a recording with 8 seconds of room noise before the music and a match that puts bar 1 at −0.3 s, nothing is changed.
- AE3. **Covers R3.** Given the same start but a corrected line-up that fails the consistency check, the original result is used and the readout does not mention a correction.

### Scope Boundaries

- A match that puts bar 1 after the recording's start, and any recording with an intro, are not touched.
- The default track and the reference choice from the earlier plan are unchanged.

#### Deferred to Follow-Up Work

- A "Start together" control for cases the check does not cover.

### Success Criteria

- For the Creep recording, the saved line-up has bar 1 within about 0.1 s of the recording's first sound and the tab and audio start together on Play.
- No change to line-ups for recordings that fail any of the three conditions.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The check is a post-step on the matcher's chosen timeline, in the alignment worker's code path, before sections are found.** Why: it needs the recording's and the tab's silent frames and the onset envelopes, which only the matcher holds, and the tab's render is already the reference actually used in that run. It runs on the timeline the matcher would return, so whole-band and viewed-track runs both get it. Governs R1, R3; carries KD1.
- KTD2. **The correction is one constant shift of the whole timeline, accepted only if the shifted timeline passes the existing consistency check and bar 1's onset prominence at the new place is at least that at the old place or at least the matcher's own bar for a convincing anchor.** Why: a constant shift keeps bar spacing, holds and sections intact, and the two existing checks are the "re-check the rest of the timeline" the decision asks for without a second full match. Governs R3.
- KTD3. **The matcher result carries a flag that the start was set, and it travels as a field on the aligned result, the analysis result and the readout status.** Why: the page decides nothing here; it only reports. Governs R4; carries KD2.
- KTD4. **Thresholds are named constants next to the check.** Margin before the start (0.15 s), recording first sound within 1 s, tab first sound within 0.5 s. Governs R1.

### Assumptions

- A first sound is the first frame the matcher's existing silence test marks as sounding; no new detector is needed.
- A rendered tab whose first note is at its start shows sound within 0.5 s, which holds for a note at tick 0 after the synth's own startup.

### Risks and Dependencies

- A recording whose first second is noise but whose music starts later could satisfy the recording condition. The onset-prominence comparison at bar 1 is the guard; the thresholds are constants so they can be tightened with real recordings.
- Depends on the earlier viewed-track plan only for the status type it extends.

---

## Implementation Units

### U1. The start check as pure functions

- **Goal:** Decide from the signals whether the start correction applies, and what the shifted timeline would be.
- **Requirements:** R1, R2, R3; KTD2, KTD4.
- **Dependencies:** None.
- **Files:** `src/alignment/start-check.ts`, `tests/alignment/start-check.test.ts`.
- **Approach:**
  - One function takes bar 1's anchor, the recording's and the tab's first-sound times, and returns whether the check applies.
  - A second returns the anchors and end anchor shifted by one constant.
  - A third accepts or rejects the shifted timeline given the consistency check's result and the two bar-1 prominences.
- **Patterns to follow:** the small pure helpers and constants in `src/alignment/timeline-check.ts`.
- **Test scenarios:**
  - Covers AE1. Bar 1 at −0.56, recording first sound 0.09, tab first sound 0.02: applies.
  - Covers AE2. Recording first sound at 8 s: does not apply.
  - Bar 1 at −0.1 (inside the margin), or at +0.5: does not apply.
  - Tab first sound at 2 s: does not apply.
  - The shifted anchors differ from the originals by one constant and keep every spacing, including the end anchor.
  - Covers AE3. A shifted timeline that fails the check is rejected; one that passes with equal or higher bar 1 prominence is accepted; lower prominence is rejected.
- **Verification:** the three functions behave as above on plain numbers, with no audio involved.

### U2. Apply the check in the matcher and carry the result

- **Goal:** The matcher applies the correction when it holds and reports that it did.
- **Requirements:** R1, R2, R3; KTD1, KTD2, KTD3.
- **Dependencies:** U1.
- **Files:** `src/alignment/match.ts`, `src/alignment/job.ts`, `src/alignment/analyze.ts`, `tests/alignment/match.test.ts`, `tests/alignment/analyze.test.ts`.
- **Approach:**
  - After the matcher picks its map and per-bar map, find the recording's and the tab's first sounding frames from the silence flags it already computes.
  - Build the candidate by U1; bar 1's position comes from the recording's first sound, refined by the existing onset refinement for bar 1; compare prominences at old and new positions; run the existing consistency check on the shifted anchors.
  - On acceptance replace the map (and the per-bar map when it has the same start problem) and set a start-set flag; carry it through the job result and the analysis result.
- **Patterns to follow:** how `refineAnchor` and `checkTimeline` are used in `matchRecording`, and how `tier` is carried through `runMatchJob`.
- **Test scenarios:**
  - Covers AE1. A synthetic tab and a recording that sounds at once, with the matcher forced to place bar 1 one beat early: the result has bar 1 near the first sound and the flag set.
  - Covers AE2. A recording with a long quiet lead-in: the result is unchanged and the flag is not set.
  - A match that already puts bar 1 at the start: unchanged.
  - Covers AE3. A candidate whose shifted timeline fails the check: the original map is returned and the flag is not set.
- **Verification:** existing match and accuracy tests still pass, and the new cases above pass.

### U3. Say it in the readout

- **Goal:** The alignment readout tells the user when bar 1 was set to the first sound.
- **Requirements:** R4; KTD3; KD2.
- **Dependencies:** U2.
- **Files:** `src/app/auto-align.ts`, `src/app/App.tsx`, `src/app/alignment-controls.ts`, `tests/app/auto-align.test.ts`, `tests/app/alignment-controls.test.ts`.
- **Approach:**
  - The aligned analysis result's flag becomes an optional field on the `lined-up` and `roughly` statuses, set where the status is built from the settled result.
  - `statusText` appends one plain sentence when it is set and nothing otherwise.
- **Patterns to follow:** the `basis` marker added to the same statuses and its sentence in `statusText`.
- **Test scenarios:**
  - A status with the field set reads "Bar 1 was set to the recording's first sound." after the existing text, for both `lined-up` and `roughly`.
  - A status without the field reads as it does today.
  - The field set together with a reference marker shows both sentences.
- **Verification:** the readout shows the sentence after a corrected line-up and not otherwise.

---

## Verification Contract

| Check | Command or step | Applies to |
|---|---|---|
| Types | `npm run typecheck` | all units |
| Tests | `npm test` | all units |
| Build | `npm run build` | all units |
| Real recording | Open the Creep tab and the Creep mp3, press Re-analyse, and confirm the readout says bar 1 was set to the first sound and Play starts tab and audio together | U2, U3 |
| Desktop smoke | Rebuild with `scripts/package-windows.ps1` and repeat the real-recording check | U2, U3 |

## Definition of Done

- Every unit's verification holds and the checks above pass.
- AE1, AE2 and AE3 each hold in tests, and the Creep recording starts together with the tab.
- No saved-record format change, and ordinary line-ups are unchanged.
- Abandoned or experimental code from approaches that did not pan out is removed from the diff.
