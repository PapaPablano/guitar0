---
title: Neck Finger Motion - Plan
type: feat
date: 2026-10-07
topic: neck-finger-motion
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Neck Finger Motion - Plan

## Goal Capsule

- **Objective:** In the full-screen neck view, a player can see the physical movement that produces each technique's sound: the note ring behaves as the fretting finger, and bends visibly push or pull the string in the direction a real bend goes.
- **Means:** One per-note finger position, computed in the technique-cue model, that the ring, the lit string and the cues all draw from (KTD1).
- **Product authority:** The user, through the brainstorm dialogue. Only the full-screen neck view and the neck frames in exported video are in scope. The 2D tab view is not active scope.
- **Open blockers:** None.
- **Execution profile:** Pure drawing and model code on branch `feat/neck-highway-style`, proven by recorded draw calls in unit tests. A final look at a real bend needs a track the user supplies, because the bundled sample has none.
- **Tail ownership:** `ce-work` implements and verifies locally; commit and PR follow the user's usual flow.

---

## Product Contract

### Summary

The note ring in full screen acts as the fretting finger, and each technique happens around it. Bends deflect the lit string the way a real bend does and stretch the ring the same way, with a small side-view inset showing the finger pushing or pulling the string. Vibrato, slides, hammer-ons and pull-offs keep their current cues, and the ring itself now rocks, glides, taps down or lifts off with them.

### Problem Frame

The neck view's technique cues animate the lit string and draw arcs and comets beside the ring, but the ring never moves. Every bend also deflects the string the same way, toward the high e side, whichever string is bent. On a real guitar the G, B and high e strings are pushed toward low E and the D, A and low E strings are pulled toward high e, so the current picture shows a movement the player's hand would not make. The motion that creates the sound is missing, which makes the cues hard to copy.

### Key Decisions

- **The ring is the finger.** Technique cues are drawn around and driven by the ring rather than by a separate fingertip pad. (session-settled: user-directed — chosen over a separate fingertip pad beside the ring: the user wants the circle to be the finger all of this happens around.) Governs R1, R5.
- **Bends get the full treatment, other techniques keep their cues.** Only bends gain the side-view inset, since they are the only technique that moves the string sideways. (session-settled: user-directed — chosen over giving every technique the inset and over leaving non-bend cues unchanged: bends only for the inset, but the ring joins the other cues.) Governs R3, R5.
- **Bend direction follows the standard guitar convention.** The assumption is that this matches what the player's hand does, and that bend size scales how far the string and ring move. Governs R2, R4.
- **The inset follows the bending note.** It sits beside the bending ring rather than in a fixed corner, and shows one bend when several sound together. (session-settled: user-approved — chosen over a fixed screen corner and over one inset per bend: proposed with the trade-off in the planning scope and confirmed.) Governs R3.

### Requirements

**Bends**

- R1. In full screen, the note ring of a bent note is drawn as the fretting finger: it stretches in the direction of the bend and follows the string as it moves.
- R2. A bent string deflects toward the low E side when it is a G, B or high e string, and toward the high e side when it is a low E, A or D string, on any supported string count.
- R3. A bent note also shows a small side-view inset in which the finger visibly slides the bent string sideways across its neighbours, in the same direction as R2. The inset sits beside the bending ring, oriented to match how the strings run on screen and kept inside the frame; when several notes bend at once it shows the lowest-pitched one.
- R4. The distance the string and ring move scales with the bend size of the note, up to the existing full-bend limit, and eases in over the start of the note as bends do today.

**Other techniques**

- R5. For vibrato, slides, hammer-ons and pull-offs, the ring moves with the existing cue: it rocks with vibrato, glides along a slide, taps down on a hammer-on destination and lifts off on a pull-off. Their existing string, comet and arc cues are kept.
- R6. Notes with no technique draw the ring exactly as they do today.

**Where it applies**

- R7. The new motion is part of the existing technique-cue switch: it shows when technique cues are on, in full screen and in exported video, and is absent when they are off.

### Acceptance Examples

- AE1. **Covers R2.** Given a bend on the B string, the lit string and ring move toward the low E side at the peak of the bend. Given the same bend on the A string, they move toward the high e side.
- AE2. **Covers R1, R3.** Given a full-step bend on the G string, the ring is stretched toward low E and the inset shows the finger pushing the G string across its neighbours.
- AE3. **Covers R4.** Given a half-step bend and a full-step bend on the same string, the half-step bend moves the string and ring about half as far.
- AE4. **Covers R5.** Given a vibrato note, the ring rocks while the note sounds; given a slide, the ring travels from the start fret to the end fret along with the comet.
- AE5. **Covers R6, R7.** Given a plain note, or technique cues switched off, the ring is the plain circle it is today.

### Scope Boundaries

- A full hand or arm model, or any change to the 2D tab view, is not part of this work.
- Pre-bends and bend releases are not shown, because the song data records only the largest bend of a note.
- The side-view inset is not shown for vibrato, slides, hammer-ons or pull-offs. It can be added later if the ring motion alone is not clear enough.

#### Deferred to Follow-Up Work

- Adding a bend to the bundled sample song so the motion can be seen without a user file.

### Dependencies / Assumptions

- Bend size is available per note as semitones, and the full-bend limit of 2 semitones still defines a full deflection (`src/render/neck-cue-model.ts`).
- The current behavior deflects every bent string up the screen toward string 1, the high e side, which the neck tests confirm is drawn at the top in landscape (`tests/render/neck-view.test.ts`); `stringOffset` in `src/render/neck-view.ts` is the code R2 changes.
- The direction convention in R2 is the standard guitar one and was accepted in the dialogue.
- Songs record a hammer-on or pull-off only as an origin note and a destination note; which of the two it is follows from whether the destination fret is higher or lower than the origin's.

### Product Contract preservation

Changed: R3 gains the inset placement and the multi-bend rule confirmed in the planning scope, recorded as a Key Decision; the two Deferred-to-Planning questions about them are resolved by it. All other requirement, example and scope IDs and meanings are unchanged.

### Sources / Research

- Current technique cues: `src/render/neck-cue-model.ts`, `src/render/neck-cues.ts`, `src/render/neck-view.ts` (`stringOffset`, `drawLitStrings`, `drawRing`).
- Earlier plan for the cues this builds on: `docs/plans/2026-10-06-0739-feat-neck-technique-cues-plan.md`.
- Directional sketch of options A, B and C for the bend look; option C was chosen, then adjusted so the ring is the finger.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One finger pose per note, owned by the cue model.** The model computes, for each note that moves, where along the string the ring is (a fractional fret), how far across it is (signed, in shares of the string gap) and a press size. The ring, the lit string, the harmonic diamond and the arcs all read it, so they cannot disagree. (session-settled: user-directed — chosen over a separate fingertip pad beside the ring: the circle is the finger.) Governs R1, R5.
- KTD2. **Bend side is decided by a string's position within the track's string count.** Strings in the upper half by number (the first `floor(count / 2)`, which is G, B and e on a six-string guitar) bend toward the lower-pitched neighbour; the rest bend toward the higher-pitched one. This keeps basses and seven-string guitars on the same rule without naming notes. Governs R2.
- KTD3. **The lit string pivots on the displaced ring.** The string leaves the ring at the full deflection and eases back to straight toward the bridge, replacing today's ramp that starts at zero at the ring. The existing travelling wave for vibrato stays on the string. Governs R1, R4.
- KTD4. **Deflection is a share of the gap to the neighbouring string.** Ring and string distances scale with the photo geometry and zoom, and a bend never needs a pixel constant. The reach constants are tuned by eye against a real bend and stay named constants beside the existing ones. Governs R4.
- KTD5. **The inset is drawn with the other cues, in screen space.** The cue-drawing space gains the frame size and string count so the inset can be placed beside the ring, oriented from the on-screen positions of the lowest and highest strings, and clamped to the frame. It draws no text, like the other cues. Governs R3, R7.
- KTD6. **Hammer-on versus pull-off is read from fret order.** A destination fret above its origin taps the destination ring down at its start; a destination below it lifts the origin ring at its end. Governs R5.

### System-Wide Impact

- Exported video draws neck frames through the same render path as full screen, so R7 holds there without separate work (`src/export/encoder.worker.ts` passes the same cue option).
- The existing guarantee that cues-off drawing matches cues-absent drawing call for call must hold; the pose is computed only when cues are on.
- Zoomed placement and the upright, rotated layout both go through the photo-to-screen mapping, so directions stay correct on screen without special cases; the inset orientation is the one place that reads screen positions directly.

### Risks & Dependencies

- A displaced ring can overlap a neighbouring string's ring in a chord where one string bends. Keeping a full bend under one string gap limits it; the look is judged in the final manual check.
- At the widest zoom the ring and inset are small. The inset has a minimum size so it stays legible.
- Per-frame cost is a few extra points per bending note; no change to the rendering budget is expected.

---

## Implementation Units

### U1. Finger pose in the cue model

- **Goal:** Compute each moving note's finger pose, and the bend side for any string count.
- **Requirements:** R1, R2, R4, R5, R6; AE1, AE3, AE4, AE5.
- **Dependencies:** None.
- **Files:** `src/render/neck-cue-model.ts`, `tests/render/neck-cue-model.test.ts`.
- **Approach:**
  1. Add the bend-side rule from KTD2 as an exported helper so other code and tests share it.
  2. Give `cuesAt` an optional string-count parameter after the lookahead, defaulting to six, so existing callers and tests keep working.
  3. Return a pose per note id only for notes that move: bend and vibrato set the across share (bend easing as today, vibrato's rock from the existing 7 Hz wave, whose constants move here from the view), slides set the along position from the comet's head, and hammer-ons and pull-offs set the press per KTD6.
  4. Name the tap and lift sizes and durations next to the existing cue constants; their values are tuned during implementation.
- **Patterns to follow:** The pure-function style of `effectOf` and `cometsOf` in the same file; constants documented beside their use.
- **Test scenarios:**
  - Covers AE1. A bend on string 2 of 6 has a positive across share toward the lower-pitched neighbour at the peak; the same bend on string 5 has the opposite sign.
  - The side rule on a four-string bass and a seven-string guitar puts the upper half of the strings on the lower-pitched side and the rest on the other.
  - Covers AE3. A one-semitone bend peaks at about half the across share of a two-semitone bend, and four semitones is capped at the two-semitone value.
  - Across eases in from zero at the note's start and is absent after it ends.
  - Covers AE4. A vibrato note's across share oscillates while it sounds, with the period of the shared wave constant, and is absent after it ends.
  - Covers AE4. A shift slide's along position runs from the start fret to the target fret over the note; a slide into a note arrives from three frets away just before it starts.
  - A hammer-on destination has a press dip right after its start and none later; a pull-off origin has a lift near its end and none earlier, per the fret order of the pair.
  - Covers AE5. A plain note, and any note outside the shown window, has no pose entry.
  - Calling `cuesAt` without the string-count parameter gives the same effects, arcs and comets as before.
- **Verification:** The model returns the poses above for synthetic notes and its existing tests still pass.

### U2. Rings, strings and cues follow the pose

- **Goal:** Draw the ring as the finger and the lit string pivoting on it, with the correct bend direction.
- **Requirements:** R1, R2, R4, R5, R6, R7; AE1, AE2, AE3, AE4, AE5.
- **Dependencies:** U1.
- **Files:** `src/render/neck-view.ts`, `src/render/neck-cues.ts`, `tests/render/neck-cues.test.ts`, `tests/render/neck-view.test.ts`.
- **Approach:**
  1. Pass the string count to `cuesAt` from `renderNeckView`.
  2. Let the ring centre take the pose: along the string by interpolating between the photo positions of the two frets, across by the share times the gap to the neighbour on the bend side, size by the press.
  3. Replace `stringOffset` with the pivot from KTD3: full deflection at the ring easing to zero toward the bridge, signed by the side from U1, plus the existing vibrato wave.
  4. Make the cue-drawing space's ring lookup pose-aware so the harmonic diamond and arcs follow the ring; the pulse keeps resting positions.
  5. With cues off no pose is computed and the draw calls stay as they were.
- **Patterns to follow:** The existing `markerCentre` and `neckSpace` mapping from photo to screen; the lit-string drawing in `drawLitStrings`.
- **Test scenarios:**
  - Covers AE1. At the peak of a bend on the B string the ring centre sits further toward the low E side than at rest; on the A string it sits toward the high e side.
  - Covers AE2. A full-step bend on the G string stretches the ring toward low E and the lit string leaves the ring displaced the same way.
  - Covers AE3. A half-step bend moves the ring about half as far as a full-step bend on the same string.
  - Covers AE4. A vibrato ring's centre differs between two times within the note and returns to rest after it; a slide's ring is between the two fret positions mid-note.
  - Covers AE5. Plain notes draw the same calls as before, and the existing test that cues off matches cues absent still passes for every technique.
  - A bend on a four-string bass track goes the way the side rule says for its string.
  - In the upright layout, the ring's screen displacement matches the photo-to-screen mapping of the same offset, so the direction is right on screen.
  - A harmonic on a bending note keeps its diamond on the displaced ring.
- **Verification:** Recorded draw calls show the ring and lit string displaced as above, and cues-off output is unchanged.

### U3. Bend inset

- **Goal:** Draw the side-view inset for a sounding bend.
- **Requirements:** R3, R7; AE2.
- **Dependencies:** U1, U2.
- **Files:** `src/render/neck-cues.ts`, `src/render/neck-cue-model.ts`, `src/render/neck-view.ts`, `tests/render/neck-cues.test.ts`.
- **Approach:**
  1. Have the cue model list the sounding bends with their note, amount and side, lowest-pitched first.
  2. Extend the cue-drawing space with the frame size and string count (KTD5).
  3. Draw the inset for the first listed bend: a row of string dots ordered as the strings run on screen, the finger pad moving the bent string's dot by the amount times the side, with the neighbours still. Fade it with the bend's easing.
  4. Place it beside the bending ring on the side away from the bend, with a minimum size, clamped inside the frame.
- **Patterns to follow:** The glow and sizing helpers in `src/render/neck-cues.ts`, and its no-text rule.
- **Test scenarios:**
  - Covers AE2. While a bend sounds the inset's draw calls are present, and the bent string's dot is displaced toward the same side as the neck bend.
  - The inset is absent for a plain note, for a note whose bend has ended, and with cues off.
  - A bend on the B string and one on the A string displace their dots in opposite directions.
  - With two notes bending at once, only one inset is drawn, for the one on the higher string number.
  - A bend with its ring near each edge of the frame, and in the upright layout, keeps every inset point inside the frame.
  - The row of dots runs the same screen way as the strings: reversed between landscape and upright.
- **Verification:** The inset draws, orients and stays on screen in the scenarios above, and nothing else in the frame changes.

---

## Verification Contract

| Check | Command | Applies to |
|---|---|---|
| Unit tests | `npm test` | U1, U2, U3 |
| Type check | `npm run typecheck` | U1, U2, U3 |
| Build | `npm run build` | Final, before shipping |
| Manual look | Run the app, open a track containing bends in full screen with technique cues on, and watch a bend on a high string, a bend on a low string, a vibrato note, a slide and a hammer-on | Final |

## Definition of Done

- All requirements R1 to R7 and examples AE1 to AE5 are met and covered by the test scenarios above.
- `npm test` and `npm run typecheck` pass, including the existing cues-off equivalence test.
- A manual look at a real bend confirms the string, ring and inset move the way a player's hand does, and exported video shows the same.
- No abandoned experimental drawing code remains in the diff.
- The 2D tab view and the technique-cue switch's behavior are unchanged.
