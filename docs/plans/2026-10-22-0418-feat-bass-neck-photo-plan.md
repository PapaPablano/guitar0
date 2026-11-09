---
title: Bass Neck Photo - Plan
type: feat
date: 2026-10-22
topic: bass-neck-photo
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Bass Neck Photo - Plan

## Goal Capsule

- **Objective:** Someone practising a bass part in the Real guitar view sees a 4-string bass neck, with the strings, frets and notes sitting where they would on a real bass, instead of a 6-string electric guitar.
- **Means:** Add a second neck photo with its own measured profile and pick it per track by string count (KTD1, KTD3).
- **Product authority:** The user. A photo picker, calibrating a bass photo of the user's own, pick effects on the bass, and the bass's sound are not active scope.
- **Open blockers:** None.
- **Execution profile:** Code. Pin the guitar view's numbers first (U1), then add the bass photo (U2) and wire it through the page (U3) and the video export (U4). Done means the Definition of Done holds and a real 4-string track has been looked at on screen and in a frame export.
- **Tail ownership:** The implementer runs the work through local verification. Committing and opening a PR happen only when the user asks.

---

## Product Contract

### Summary

The Real guitar neck view draws the user's Fender Jazz Bass photo whenever the selected track has exactly 4 strings. Guitar tracks, and bass tracks with 5 or 6 strings, keep the current guitar photo. The exported video follows the view. Nothing new appears in the settings.

### Problem Frame

The Real guitar view draws glowing rings over one photo, an electric guitar with six strings. A bass track has four, so its rings are spread across six-string spacing on a neck that does not match, and the picture reads as the wrong instrument. The user supplied a photo of their own Jazz Bass to use instead.

### Key Decisions

- **The bass photo applies automatically to bass tracks.** Chosen over a user-selectable photo and over replacing the guitar photo for every track. Governs R1, R2, R3. (session-settled: user-directed — chosen over a photo picker and a global swap: no extra setting to manage, and guitar tracks keep the photo they match.)

### Requirements

**Which photo**

- R1. A track with exactly 4 strings shows the bass photo in the Real guitar view, live, in full screen and in the exported video.
- R2. Every other track shows the guitar photo exactly as it does today.

**How it draws**

- R3. On the bass photo, strings, fret wires, ring positions, lit strings, the fret numbers under the board and the open and muted symbols follow the bass's 4 strings and 20 frets, and the photo is shown headstock-left like the guitar photo, upright on a tall screen.
- R4. The bass photo has no pick point, so the pick effects do not apply to it. Rings, lit strings and technique cues still draw.

### Scope Boundaries

- Choosing the photo by the track's instrument name or sound is out. Only the string count decides.
- Letting the user pick, replace or calibrate a bass photo is out. The existing calibration is for the pick view and stays six-string.
- The pick view and the fretboard view are unchanged.
- The bass's synth sound is unchanged.

#### Deferred to Follow-Up Work

- Notes above fret 20 on a bass with more frets draw on fret 20, as notes past the last fret already do on the guitar photo. Add frets only if a real file needs them.

### Success Criteria

- A 4-string track shows the bass photo with rings on the correct strings and frets, checked on a real frame and not only in tests.
- Every frame of a guitar track is identical to before the change.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Pre-rotate the bass photo into a bundled landscape asset** (`src/assets/bass-photo.jpg`, headstock left) and measure the profile on that. The whole renderer, the profile format and the tall-screen turn in `photoPlacement` assume a headstock-left photo, so a one-off rotation avoids a second rotation path. The supplied portrait original is not committed.
- KTD2. **A profile's own string rows set its string count.** `photoStringY` spreads a track's strings across `profile.stringKnotsY.length` rows instead of a fixed six, and the board's edges come from the first and last rows. The guitar profile has six rows, so its numbers do not change. `isNeckProfile` accepts any profile with at least two rows.
- KTD3. **One pure function picks the photo.** `neckProfileFor(stringCount)` returns the bass profile for exactly 4 and the guitar profile otherwise, and `neckPhotoKind(stringCount)` names the matching image. The page, full screen and export all ask it, so they cannot disagree (R1, R2).
- KTD4. **The stage frame picks the profile from the track.** `renderStageFrame` asks `neckProfileFor` for the Real guitar view, and the export dialog only chooses which photo to load. The profile and the page's choice come from one function, so a frame can never pair the bass photo with the guitar profile, and no new field travels to the worker.
- KTD5. **Measure the bass profile by hand, not through `calibrate`.** `calibrate` fits six strings from seven taps, including a pick point. Bending it to four strings serves a feature outside this scope. The profile's units are chosen so the 12th fret sits about as far from the nut as on the guitar profile (about 456 units), which keeps the camera and zoom constants in `src/render/neck-view.ts` valid.

### Risks

- **The source photo is small.** It is 572 by 1024, and the neck is about 40 pixels across once rotated, so a tight zoom on a phone will look soft. The profile is measured against the photo as it is. If it looks too soft, ask the user for the original at full size before changing anything else.
- **Hand-measured numbers can be off by a few units.** Rings would sit slightly off their frets. U2 checks this by overlaying the profile on the photo and by rendering real frames.

---

## Implementation Units

### U1. Make string geometry follow the profile

- **Goal:** `photoStringY` and the board edges work for any number of string rows, with the guitar's output unchanged.
- **Requirements:** R2, R3.
- **Dependencies:** None.
- **Files:** `src/render/neck-view.ts`, `src/render/neck-profile.ts`, `tests/render/neck-view.test.ts`, `tests/render/neck-profile.test.ts`, `tests/export/stage-frame-unchanged.test.ts`.
- **Approach:**
  - Replace the fixed `5` gaps in `photoStringY` and the fixed `1` and `6` in `boardTop` and `boardBottom` with the profile's first and last rows (KTD2).
  - Relax `isNeckProfile` from exactly six rows to at least two, all the same length as the knot list.
  - Leave `PICK_PROFILE` and `NECK_PROFILE` untouched.
- **Execution note:** Run the existing characterization tests first. They pin the guitar's ring, string and placement numbers, and they must pass unchanged.
- **Patterns to follow:** The characterization block at the top of `tests/render/neck-profile.test.ts`.
- **Test scenarios:**
  - On `NECK_PROFILE`, every number in the existing "keeps its numbers" block is unchanged, including `photoStringY(1, 4, 500)` and `photoStringY(4, 4, 500)` from the existing bass spread test.
  - A synthetic 4-row profile gives `photoStringY(1, 4, x)` equal to its first row and `photoStringY(4, 4, x)` equal to its last at a knot.
  - On that profile the two middle strings sit between the outer two, in order, at a point between knots.
  - A 4-row profile drawn through `renderNeckView` puts the board's top and bottom edges just outside the first and last rows, not outside a sixth row.
  - `isNeckProfile` accepts a 4-row profile and rejects one with a single row or with rows of different lengths.
  - The `sane` profile checks in `neck-profile.test.ts` read the string count from the profile instead of a literal 6.
  - Pinned guitar frames in `stage-frame-unchanged.test.ts` still match.
- **Verification:** The guitar's numbers and pinned frames are unchanged, and a 4-row profile draws a 4-string neck.

### U2. Add the bass photo and its profile

- **Goal:** A bundled landscape bass photo and a measured `BASS_PROFILE` that rings and strings land on.
- **Requirements:** R3, R4.
- **Dependencies:** U1.
- **Files:** `src/assets/bass-photo.jpg`, `src/render/neck-profile.ts`, `tests/render/neck-profile.test.ts`.
- **Approach:**
  - Turn the supplied photo a quarter turn so the headstock is on the left and the high G string is at the top (KTD1), and save it as the bundled asset.
  - Measure on the turned photo: the nut, each of the 20 fret wires, four string rows at the nut, the 12th fret, the last fret and the bridge, the point the strings end, the stretch of neck to show, the neck's row, and the inlay frets (3, 5, 7, 9, 12, 15, 17, 19).
  - Choose profile units per KTD5 and set `photoWidth` and `photoHeight` in those units. `drawImage` scales the photo to them.
  - Leave `pickX` out (R4). Past the last fret the body shows dimmed, as the guitar photo's does.
  - Check the numbers by drawing them over the photo, then by rendering real frames of a 4-string track (alphaTex, as `tests/model/file-tuning.test.ts` does) on a wide and a tall screen.
- **Execution note:** Visual verification matters more than the unit test here. The test can only prove the profile is well-formed, not that it lands on the wood.
- **Patterns to follow:** `NECK_PROFILE` and `PICK_PROFILE` in `src/render/neck-profile.ts`.
- **Test scenarios:**
  - `BASS_PROFILE` passes the same `sane` checks as the other profiles: nut before increasing fret wires, four strings strictly ordered at every knot, everything inside the photo.
  - It has 20 fret wires and no `pickX`.
  - `isNeckProfile(BASS_PROFILE)` is true.
- **Verification:** On a real frame, rings sit between the right fret wires on the right strings from the nut to fret 20, and the lit string runs on to the bridge.

### U3. Choose the photo by string count on the page

- **Goal:** The Real guitar view and its full-screen form show the bass photo for a 4-string track.
- **Requirements:** R1, R2.
- **Dependencies:** U2.
- **Files:** `src/render/neck-profile.ts`, `src/app/use-neck-photo.ts`, `src/app/panel-draw.ts`, `src/app/Stage.tsx`, `src/app/PanelFullscreen.tsx`, `tests/render/neck-profile.test.ts`.
- **Approach:**
  - Add `neckProfileFor` and `neckPhotoKind` beside the profiles (KTD3).
  - Let `useNeckPhoto` take a kind, defaulting to the guitar, so each caller adds one more call for the bass photo.
  - Add the bass image to `PanelDrawState`. The `neck` case in `drawSurface` picks image and profile from the selected track's string count and passes the profile to `renderNeckFrame`.
  - Switching tracks mid-song changes the photo on the next frame, because the choice is made per draw.
- **Patterns to follow:** How the `pick` case passes `pickPhoto` and its profile in `src/app/panel-draw.ts`.
- **Test scenarios:**
  - `neckProfileFor(4)` is `BASS_PROFILE`, and 0, 1, 5, 6 and 7 give `NECK_PROFILE`.
  - `neckPhotoKind` is `'bass'` only for 4.
  - Until the bass image has loaded, a 4-string track draws the plain dark frame with its rings, as the guitar view does before its photo loads.
- **Verification:** Loading a 4-string file and the sample riff in turn shows the bass photo, then the guitar photo, in the panel and in full screen.

### U4. Follow the choice in the exported video

- **Goal:** A video of a 4-string track's Real guitar view shows the bass photo.
- **Requirements:** R1, R2.
- **Dependencies:** U3.
- **Files:** `src/export/neck-photo.ts`, `src/render/stage-frame.ts`, `src/app/ExportDialog.tsx`, `tests/export/stage-frame-unchanged.test.ts`, `tests/export/composite-views.test.ts`.
- **Approach:**
  - `loadNeckPhoto` takes the kind and loads that asset.
  - `ExportDialog` asks `neckPhotoKind` for the exported track and loads that photo.
  - The `neck` case in `renderStageFrame` passes `neckProfileFor` for the track's string count (KTD4).
- **Patterns to follow:** The `pickPhoto` field through `exporter.ts`, the worker message and `renderStageFrame`.
- **Test scenarios:**
  - A `renderStageFrame` call with the `neck` panel and a 6-string timeline draws exactly as the pinned frame does.
  - The same call with a 4-string timeline draws the photo at the bass profile's size.
  - Two frames of the same 4-string track at the same time draw identical calls.
- **Verification:** A short real export of a 4-string track shows the bass photo, and one of a guitar track is unchanged.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Unit tests | `npm test` | All units |
| Types | `npm run typecheck` | All units |
| Build | `npm run build` | U2 (the new asset), U4 |
| Visual check | Dev server (`npm run dev`) with a 4-string alphaTex file, wide and tall, plus one short export | U2, U3, U4 |

---

## Definition of Done

- Every unit's verification holds and the four gates above pass.
- Guitar frames, live and exported, are identical to before.
- A 4-string track shows the bass photo with rings on the right strings and frets, seen on screen and in an exported frame.
- No dead experiments are left in the diff, and the supplied portrait original is not added to the repository.
