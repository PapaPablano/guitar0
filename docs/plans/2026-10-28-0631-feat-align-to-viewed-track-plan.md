---
title: Align To Viewed Track - Plan
type: feat
date: 2026-10-28
topic: align-to-viewed-track
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Align To Viewed Track - Plan

## Goal Capsule

- **Objective:** A guitarist who loads a recording of a song whose tab has several guitars and other parts finds the recording lined up with the part they are playing, not skewed by parts the recording does not contain.
- **Means:** Build the alignment's reference sound from the track in the main panel only, and fall back to the whole band when that does not give a usable timeline (KTD1, KTD2).
- **Product authority:** The user. Matching stems, pinning a sync track separate from the view, and the start-delay and output-latency work are not active scope.
- **Open blockers:** None.
- **Execution profile:** Code. The reference render first (U1), then the run and its fallback (U2), then the readout (U3). Done means the Definition of Done holds and a multi-guitar file has been lined up against a real recording on the viewed track and again after a track switch plus Re-analyse.
- **Tail ownership:** The implementer runs the work through local verification. Committing and opening a PR happen only when the user asks.

**Product Contract preservation:** Product Contract is new; there was no upstream brainstorm file.

---

## Product Contract

### Summary

Auto-alignment compares the recording with a synthesized render of the tab. It will render only the track in the main panel instead of every track. Re-analyse is the only thing that lines the recording up again for a different track. If the viewed track does not give a usable timeline, the app lines up on the whole band without asking, and the alignment readout says which reference the current timeline came from.

### Problem Frame

A Guitar Pro file can hold several guitars (acoustic, clean, distorted, lead, rhythm) and also bass, drums and keys. The alignment renders all of them and compares the result with the recording. A part the recording does not contain, or plays differently, adds pitch and onset evidence that does not match, and the timeline can land off. The user's recording is out of step from the start and stays that way, and the cause is not visible anywhere in the readout.

### Key Decisions

- KD1. **The alignment reference is the viewed track only.** (session-settled: user-directed — chosen over all guitar tracks, over auto-detecting which tracks the recording has, and over guitar tracks with a switch-off list: the user wants the sync tied to the part they play.) Governs R1.
- KD2. **Switching tracks leaves the sync alone; only Re-analyse lines up again for the new track.** (session-settled: user-directed — chosen over re-aligning on every switch and over asking each time: timing must not move while someone is practising.) Governs R2.
- KD3. **When the viewed track gives no usable timeline, the app falls back to the whole band without a prompt.** (session-settled: user-directed — chosen over saying so and offering the fallback, and over leaving the sync unset.) Governs R3.
- KD4. **"Viewed track" is the track in the main panel.** (session-settled: user-approved — chosen over asking which panel to use when two panels show different tracks.) Governs R1.
- KD5. **The alignment readout names the reference used, with no prompt.** (session-settled: user-approved — chosen over leaving the readout unchanged, since a silent fallback hides a wrong sync.) Governs R4.
- KD6. **A saved timeline stays as saved and is not redone because the viewed track differs.** (session-settled: user-approved — chosen over re-running the match when a song is opened on another track.) Governs R5.

### Requirements

**Reference**
- R1. Line-up compares the recording with a render of the main panel's track alone; every other track is silent in that render.
- R2. Changing the viewed track does not start a line-up or change the timeline in use. Re-analyse uses the track in the main panel at the moment it is pressed.

**Fallback and feedback**
- R3. When a line-up on the viewed track finds no usable timeline because it is not confident or fails the consistency check, the app runs one more line-up against the whole band and applies that result by the same rules, with no prompt. A silent recording, a recording or tab too long to analyse, a failed render or decode, and a cancelled run do not trigger it.
- R4. After a line-up, the alignment readout says whether the timeline came from the viewed track or from the whole band.

**Saved timelines**
- R5. A saved timeline is restored exactly as before and the stored record format does not change.

### Acceptance Examples

- AE1. **Covers R1.** Given a tab with an acoustic and an electric guitar and a recording that has only the electric, when the electric track is in the main panel and the recording loads, the reference render contains the electric track and no other.
- AE2. **Covers R2.** Given a recording already lined up, when the user switches the main panel to the acoustic track, the timeline and the readout are unchanged and no line-up starts.
- AE3. **Covers R3, R4.** Given the acoustic track in the main panel and a recording that lacks it, when Re-analyse finds no confident result on that track, a second line-up runs on the whole band, a timeline is applied if that one is consistent, and the readout says "whole band".

### Scope Boundaries

- A recording made of separated stems is lined up as it is today.
- A viewed bass or keys track is a valid reference like any other; the track chooser already lists playable tracks only.
- The start-delay and output-latency work done earlier is separate and is not changed here.

#### Deferred to Follow-Up Work

- Choosing a sync track independent of the view, or one per panel.
- Detecting which tracks the recording contains and weighting them.

### Success Criteria

- With a multi-guitar tab and a recording that has one of those guitars, the timeline's per-bar results are at least as good when that guitar is viewed as with the whole band.
- A recording that has none of the viewed track still ends up lined up, as it is today.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The reference render silences other tracks through the existing offline export's per-track volume, selected by a new option naming one track.** Why: the export already sets per-track volumes for programme gain and the play-along mute, so no new render path exists. The option takes precedence over `fullBand`, an out-of-range index renders the whole band, and the play-along mute never applies to it. Governs R1; carries KD1, KD4.
- KTD2. **The fallback is decided by a pure function next to `settleAnalysis`, and the run loop in `startAlignment` starts the second job.** Why: the outcome rules (which results count as "not confident or inconsistent") are testable without the page, and `startAlignment` already owns job cancellation and stale-run checks. The fallback runs at most once per request, for first opens and re-detections alike. Governs R3; carries KD3.
- KTD3. **The reference track is read from `live.current` when a run starts, and a run keeps that track to its end.** Why: `startAlignment` is called from an effect and reads refs; a track switch during a run must not change a job already in flight. Governs R1, R2; carries KD2, KD4.
- KTD4. **`lined-up` and `roughly` statuses gain an optional reference marker, and the stored alignment record gains nothing.** Why: a timeline restored from storage has no known reference, so the marker is optional and the readout stays as it is then. Governs R4, R5; carries KD5, KD6.

### Assumptions

- A track rendered alone carries enough pitch and onset content for the matcher; thin tracks fall through to the whole-band run through R3 rather than needing a content check.
- Rendering twice on a miss is acceptable: the render and match are background work with a progress readout.

### Risks and Dependencies

- The automatic line-up on load uses whichever track the page selects first (the first playable track), which may not be the part the user plays. Re-analyse after picking the right track is the remedy; nothing here changes the default.
- A track that is present but sparse (a short lead part) can match weakly. The fallback keeps the user from being left without a timeline; the readout shows when it happened.

---

## Implementation Units

### U1. Render a single track for the reference

- **Goal:** The offline export can render one named track alone, so the alignment can compare the recording with it.
- **Requirements:** R1; KTD1.
- **Dependencies:** None.
- **Files:** `src/audio/synth-bridge.ts`, `tests/audio/synth-clock.test.ts`.
- **Approach:**
  - Add an option naming one track to the export options; when it names a valid track, set every other track's volume to 0 and leave the named track at its programme gain.
  - It overrides `fullBand` and ignores the silenced play-along track.
  - An index outside the score's tracks behaves as `fullBand`.
- **Patterns to follow:** the existing `silentTrack` and `fullBand` handling in `exportAudio`, and its tests.
- **Test scenarios:**
  - Covers AE1. A three-track score with the track at index 1 named: tracks 0 and 2 have volume 0 and track 1 keeps its programme gain.
  - Track 1 named while track 1 is the play-along silent track: track 1 is still rendered.
  - Index 9 on a three-track score: no track is zeroed.
  - `fullBand` alone still leaves every track untouched.
  - Track named together with `fullBand`: the named track alone is rendered.
- **Verification:** the export options carry zero volumes for every track but the named one, and existing export tests still pass.

### U2. Line up on the viewed track, with one whole-band fallback

- **Goal:** Loading a recording and pressing Re-analyse compare it with the main panel's track and fall back once to the whole band when that gives no usable timeline.
- **Requirements:** R1, R2, R3, R5; KTD2, KTD3; KD1, KD2, KD3, KD4, KD6.
- **Dependencies:** U1.
- **Files:** `src/app/App.tsx`, `src/app/auto-align.ts`, `tests/app/auto-align.test.ts`.
- **Approach:**
  - Add the main panel's track to the live state `startAlignment` reads, and pass it as the single track to the reference render.
  - Add a pure decision on a finished analysis: it asks for the whole-band run only when settling the result commits no timeline and the cause is `not-found` with `not-confident`, or `aligned` with every candidate map failing the consistency check, and for nothing else (R3). A first open whose bar-by-bar map passes the check is committed as roughly lined up and does not fall back.
  - In `startAlignment`, when that decision fires, start one more job with `fullBand` and settle its result with the existing rules; the alignment job reference points at the running job so cancel still works.
  - Leave the effects that start a run keyed as they are, so a track switch does not start one (R2), and leave the saved-profile paths untouched (R5).
- **Patterns to follow:** `settleAnalysis`, and the stale-run checks around `alignRuns` in `startAlignment`.
- **Test scenarios:**
  - `not-found` with `not-confident` asks for the whole-band run.
  - `aligned` whose whole-song and bar-by-bar maps both fail the consistency check asks for it on a first open; on a re-detection a failing whole-song map asks for it.
  - `aligned` whose whole-song map fails but whose bar-by-bar map passes, on a first open, does not ask for it.
  - `not-found` with `silent` or `too-long`, a `failed` result and a `cancelled` result do not ask for it.
  - An `aligned` result that passes the check does not ask for it.
  - Covers AE3. A fallback run's result is settled by the same rules: a consistent result commits, an inconsistent one keeps the timeline in use on a re-detection.
  - The fallback runs at most once for one request.
- **Verification:** with a recording that lacks the viewed track, a timeline is still applied from the whole band; with one that has it, one render and one match run.

### U3. Say which reference was used

- **Goal:** The alignment readout tells the user whether the timeline came from the viewed track or the whole band.
- **Requirements:** R4; KTD4; KD5.
- **Dependencies:** U2.
- **Files:** `src/app/auto-align.ts`, `src/app/alignment-controls.ts`, `tests/app/alignment-controls.test.ts`, `tests/app/auto-align.test.ts`.
- **Approach:**
  - Add an optional marker for the reference to the `lined-up` and `roughly` statuses; `settleAnalysis` callers set it from the run that produced the result.
  - `statusText` appends one plain sentence for each marker value and nothing when the marker is absent.
- **Patterns to follow:** the `skipped` text already appended in `statusText`.
- **Test scenarios:**
  - `lined-up` with the viewed-track marker names the viewed track.
  - `roughly` with the whole-band marker names the whole band and keeps the existing "roughly" wording.
  - A status with no marker reads exactly as it does today.
  - The marker set by a fallback run is the whole-band one, and by a first run the viewed-track one.
- **Verification:** the readout shows the reference after a fresh line-up and is unchanged for a timeline restored from storage.

---

## Verification Contract

| Check | Command or step | Applies to |
|---|---|---|
| Types | `npm run typecheck` | all units |
| Tests | `npm test` | all units |
| Build | `npm run build` | all units |
| Real recording | Load a multi-guitar tab and a recording with one of its guitars; view that guitar and confirm the readout names the viewed track, then switch to another guitar and confirm nothing moves until Re-analyse | U2, U3 |
| Desktop smoke | Rebuild with `scripts/package-windows.ps1` and repeat the real-recording check in the app | U2, U3 |

## Definition of Done

- Every unit's verification holds and the checks above pass.
- AE1, AE2 and AE3 each hold on a real tab and recording.
- No saved-record format change, and no change to the stems line-up or to playback timing.
- Abandoned or experimental code from approaches that did not pan out is removed from the diff.
