---
title: Clean Tab Strip Layout - Plan
type: feat
date: 2026-10-18
topic: tab-strip-clean-layout
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Clean Tab Strip Layout - Plan

## Goal Capsule

- **Objective:** Playing along with the tab strip feels as easy to read as a Guitar Pro tab page, including fast passages, while the strip keeps the app's dark look.
- **Product authority:** The user. Only the tab strip's notation and spacing are active scope. The highway, neck view, technique symbols and rests/dots/triplets are not.
- **Open blockers:** None.

## Product Contract

### Summary

The tab strip gains a TAB clef and time signature at the left, beams joining notes, beat ticks, and larger, bolder fret numbers. Notes are spaced by note value instead of raw time, so fast runs get room and bars grow to fit their content. It stays dark, with the yellow cursor.

### Problem Frame

The strip today (`src/render/tab-strip.ts`) draws plain fret numbers, single stems with small flags, and bars sized by seconds with a minimum width. Dense passages bunch up, bar widths look uneven, and with no clef or time signature it reads as a rough diagram rather than a tab page. Next to Guitar Pro it looks unclean, and the user weighs spacing and look equally.

### Key Decisions

- **Dark hybrid, not a light "paper" page.** Keeps the app's look and cursor; a light/dark toggle is a possible later addition. (session-settled: user-directed — chosen over a Guitar Pro-style light page and over a tidied version of today's strip: picked from the three directions sketched.) Governs R1, R4.
- **Spacing follows note value, not seconds.** Dense runs read better at the cost of bars varying in width. (session-settled: user-approved — chosen over today's time-proportional spacing.) Governs R5, R6.
- **Technique symbols stay as they are.** This pass is spacing, notation and legibility only. (session-settled: user-directed — chosen over adding arrows, slides and arcs.) Governs R9.

### Requirements

**Notation**

- R1. A TAB clef and the current time signature appear at the left of the strip and stay visible while the strip scrolls.
- R2. Notes within a beat are joined by beams, with a second beam for sixteenths, replacing today's single flags.
- R3. Faint beat ticks mark the beats within each bar.
- R4. Fret numbers are larger and bolder than today and stay readable against the strings and each other.

**Spacing and playback**

- R5. Horizontal space is allotted by note value, so every note gets at least the room a two-digit fret number needs, longer notes get more, and a bar grows to fit its content.
- R6. The cursor moves through each bar by playback time, so it stays locked to the audio even when bars are laid out unevenly.
- R7. Clicking a bar to select it and the loop highlight work as they do today on the new layout.
- R8. Repeats and tempo changes still place the cursor at the right bar, as they do today.

**Unchanged**

- R9. Bends, slides, hammer-ons, palm mutes and other technique marks keep their current text-mark look; rest symbols, dot glyphs and triplet brackets are not added.

### Acceptance Examples

- AE1. **Covers R2, R5.** Given a bar of sixteenth notes next to a bar of eighths, when both are on screen, then each sixteenth has enough room that no two fret numbers touch, and the sixteenths are joined by double beams.
- AE2. **Covers R6.** Given a bar with a long gap then a fast run, when playback crosses it, then the cursor sits on each note as it sounds, moving faster across the gap or slower across the run than a constant-speed sweep.
- AE3. **Covers R1.** Given a song with a time-signature change, when the strip scrolls past it, then the clef and the signature shown at the left update to the signature of the bar at the cursor.

### Success Criteria

- Side by side with Guitar Pro on the same song, the user finds the strip comparably clean, including its fastest section.
- No existing strip behaviour regresses: bar click-to-select, loop highlight, repeats.

### Scope Boundaries

**Deferred for later**

- Technique notation as arrows, slanted lines and arcs.
- Rest symbols, dot glyphs and triplet brackets.
- A light/dark toggle for the strip.

### Dependencies / Assumptions

- Time signature is already available per bar in the score model (`BarEvent.timeSignature` in `src/model/score.ts`).
- The strip is drawn in the main panel and the fullscreen/stage views through the same renderer (`src/app/panel-draw.ts`, `src/render/stage-frame.ts`), so one change covers both.

### Outstanding Questions

**Deferred to Planning**

- The scale constants of KTD1 (growth rate of slot width with duration). There is no hard cap on bar width, because the slot floor must win over any cap for R5 and AE1 to hold; tune the constants at the side-by-side check so dense bars stay compact.
- How the strip's layout is cached and how bar click-to-select maps a screen position back to a bar once widths are uneven.

### Sources / Research

- `src/render/tab-strip.ts` — current layout (`STRIP_PX_PER_SECOND`, `MIN_BAR_WIDTH`), stems/flags, cursor placement.
- `src/app/panel-draw.ts` — bar hit-testing via `scoreBarAtX`.
- Directional sketch of three directions; the user chose the dark hybrid (C).

---

## Planning Contract

Product Contract preservation: changed R5 (reworded to resolve a contradiction with the note-value spacing decision; it had said a sixteenth run is not narrower per note than an eighth passage, which sub-linear note-value spacing cannot satisfy, and now guarantees a minimum room per note with more for longer notes). R9 and the Scope Boundaries now say dot glyphs and rests are not added, matching the Assumptions.

### Key Technical Decisions

- KTD1. **One slot per onset, width from a compressed note-value scale.** Each distinct onset in a bar gets a slot whose width grows with the time to the next onset, but sub-linearly and with a floor, so a sixteenth run is roomy and a whole note is not a wall of empty space. The floor is a constant sized to two digits at the upper clamp of the fret-number font (KTD6) plus padding, so it never depends on panel height. The bar is the sum of its slots plus padding, with today's minimum bar width as a floor. Implements R5 under the note-value-spacing Key Decision.
- KTD2. **The cursor interpolates by seconds between slot anchors.** Each slot records its start time, and the playhead x is a straight-line blend between the two surrounding anchors (the bar's start and end are anchors too). This keeps the cursor on the audio through tempo changes inside a bar and across repeats. Implements R6, R8.
- KTD3. **Bar x and width must not depend on canvas size.** Callers in `src/app/App.tsx` build the layout at 1x1 only to read bar start times, and the layout cache is keyed by canvas size, so width-independence keeps those callers and `scoreBarAtX` valid without edits. Implements R7.
- KTD4. **The clef and time signature are a fixed overlay drawn last.** An opaque gutter at the left covers notes scrolling under it, and the cursor sits to the right of it. The time signature shown is the one of the bar being played, so it changes at a signature change. Implements R1.
- KTD5. **Beam groups come from a pure helper, per beat.** Onsets shorter than a quarter note are grouped by the beat they start in (beat length from the bar's time-signature denominator, except compound meters whose denominator is 8 and numerator a multiple of 3, which beat in dotted quarters of three eighths), with one beam for eighths and a second for sixteenths, and a lone short note keeps a flag. A pure helper is testable without a canvas. Implements R2; per-beat grouping is the simple choice over Guitar Pro's per-signature grouping.
- KTD6. **Fret numbers scale with string spacing.** Font size derives from the gap between strings, clamped between a floor and a ceiling chosen with KTD1's slot floor, so the numbers stay legible in the short full-screen panel as well as the main one and never outgrow their slot. Implements R4.

### Assumptions

- Dotted and triplet notes get beams and flags from their actual durations rounded to the nearest power-of-two value; exact dot and tuplet notation is deferred with R9.
- The new text (clef, signature) reuses the existing `barLabel` colour in `src/render/theme.ts`; no new theme fields are required.

---

## Implementation Units

### U1. Note-value spacing layout

- **Goal:** Replace seconds-based bar widths with slot-based widths so bars grow to fit their notes.
- **Requirements:** R5; AE1.
- **Dependencies:** none.
- **Files:** `src/render/tab-strip.ts`; `tests/render/tab-strip.test.ts`.
- **Approach:**
  1. Extend `StripBar` with its slots (onset tick, onset seconds, x offset within the bar) while keeping `x`, `width`, `playback`, `notes`, `repeatStart` and `repeatEnd`.
  2. Build slots in `buildStripLayout` per KTD1; bars with no notes keep the minimum width.
  3. Keep bar `x` and `width` independent of canvas size (KTD3).
- **Patterns to follow:** the existing `buildStripLayout` and its use of `barSpans` in `src/render/bars.ts`.
- **Test scenarios:**
  - Covers AE1. A bar of sixteenths next to a bar of eighths: no two note x positions in either bar are closer than two digits at the font's upper clamp, checked at both a short and a tall panel height.
  - A bar with one whole note is not wider than a bar of eight eighths.
  - A bar with no notes has the minimum bar width.
  - Bar `x` and `width` are identical for layouts built at 1x1 and at 900x200.
  - Two notes starting on the same tick (a chord) share one slot.
  - Repeats still list each bar's notes once, as the existing layout test expects.
- **Verification:** layout tests pass, and total strip width grows only where a bar's notes need it.

### U2. Cursor and bar picking on uneven bars

- **Goal:** Keep the cursor, scrolling, bar picking and loop highlight correct on the new layout.
- **Requirements:** R6, R7, R8; AE2.
- **Dependencies:** U1.
- **Files:** `src/render/tab-strip.ts`; `tests/render/tab-strip.test.ts`; `src/app/panel-draw.ts` only if its bar picking needs a change (not expected).
- **Approach:**
  1. Compute `playheadStripX` by interpolating between slot anchors per KTD2.
  2. Leave the signatures of `stripScrollX`, `scoreBarAtX`, `scoreBarStartSeconds` and `stripBarFor` unchanged; U4 adds the gutter exclusion inside `scoreBarAtX`.
  3. Rewrite the existing cursor tests that assume an even sweep across a bar.
- **Execution note:** Rewrite the cursor tests to the new rule first, then change the code.
- **Test scenarios:**
  - Covers AE2. A bar with a long gap then a fast run: at each note's start time the playhead x equals that note's x, and the cursor speed differs between the gap and the run.
  - Playback just before and just after a repeat jump lands on the repeated bar's start, as today.
  - A tempo change inside a bar keeps the playhead on each note at its start time.
  - `scoreBarAtX` returns the bar whose widened span contains the pointer, and null outside the score.
  - The playhead x minus the scroll equals the cursor x at several times.
  - The loop highlight spans from the first loop bar's left edge to the last loop bar's right edge.
- **Verification:** existing and rewritten strip tests pass, and the seek and loop code in `src/app/App.tsx` needs no edits.

### U3. Beams, beat ticks and larger numerals

- **Goal:** Draw beamed rhythm, beat ticks and bolder, scaled fret numbers.
- **Requirements:** R2, R3, R4, R9; AE1.
- **Dependencies:** U1.
- **Files:** `src/render/tab-beams.ts` (new); `src/render/tab-strip.ts`; `tests/render/tab-beams.test.ts` (new); `tests/render/tab-strip.test.ts`.
- **Approach:**
  1. Add a pure helper that turns a bar's onsets and time signature into beam groups per KTD5.
  2. Replace the flag drawing in `drawBarNotes` with stems plus beams from that helper, keeping a flag for a lone short note.
  3. Draw faint beat ticks above the staff at each beat's x position, interpolated between slots.
  4. Scale the fret-number font with string spacing and make it bold (KTD6), keeping the string break behind each number.
  5. Leave technique marks as they are (R9).
- **Patterns to follow:** the stem and mark drawing in `drawBarNotes`; `fretLabel` and `techniqueMark` in `src/render/techniques.ts`.
- **Test scenarios:**
  - Two eighths in one quarter-note beat of 4/4 form one beam group; four eighths spanning two beats form two groups.
  - Four sixteenths in a beat form one group with a second-level beam over all four.
  - A lone eighth gets a flag and no beam.
  - In 6/8, six eighths form two beam groups of three (dotted-quarter beats).
  - A chord (same onset, several strings) draws one stem and counts once in a group.
  - Notes of a quarter or longer draw no beam.
  - A recording-context render of a 4/4 bar draws three inner beat ticks.
  - Fret numbers draw in a larger font than before, and the size shrinks with a short panel height but never below the clamp floor.
  - The cursor still draws before the fret numbers.
- **Verification:** the tab-beams and strip render tests pass.

### U4. Fixed clef and time-signature gutter

- **Goal:** Show a TAB clef and the time signature of the bar being played, fixed at the left.
- **Requirements:** R1; AE3.
- **Dependencies:** U1, U2.
- **Files:** `src/render/tab-strip.ts`; `tests/render/tab-strip.test.ts`.
- **Approach:**
  1. Reserve a left gutter whose width is a constant exported from `src/render/tab-strip.ts`, and set the cursor x to the larger of today's width fraction and the gutter width plus a fixed margin (KTD4).
  2. Make `scoreBarAtX` return null for a canvas x inside the gutter, so a click on the clef cannot select a bar hidden under it.
  3. Draw the gutter last: an opaque fill, the string lines continuing, the stacked TAB letters and the signature digits.
  4. Take the signature from the playback bar at the current time, so it updates at a change.
- **Test scenarios:**
  - Covers AE3. A score that changes from 4/4 to 3/4: rendering before the change draws "4" over "4", and rendering after it draws "3" over "4".
  - The gutter draws after the fret numbers, so a note scrolling under it is hidden.
  - The cursor x is greater than the gutter width at the narrowest supported panel width.
  - `scoreBarAtX` returns null for a pointer inside the gutter and still returns the bar under the pointer just right of it.
  - Rendering at time 0 on a one-bar score draws the clef without throwing.
  - Rendering is deterministic for the same time (the existing repeat-render test still passes).
- **Verification:** gutter tests pass, and a manual look at the main and full-screen views shows no note drawn over the clef.

---

## Verification Contract

| Check | Command or action | Proves |
|---|---|---|
| Types | `npm run typecheck` | The layout and drawing changes compile across `src/app` and `src/render` callers |
| Unit and render tests | `npm test` | Layout, cursor, bar picking, beams and gutter behave as the units describe |
| Production build | `npm run build` | The strip builds into the web bundle |
| Side-by-side look | Open the same song in the app (main panel and full-screen) next to Guitar Pro | The Success Criteria: comparably clean, including the fastest section |

## Definition of Done

- Every unit's test scenarios pass under `npm test`, and `npm run typecheck` and `npm run build` are clean.
- R1 to R9 hold: technique marks look as they do today, rests and triplet brackets are still not drawn, no dot glyphs are added, and dotted notes are drawn with beams and flags from their rounded durations.
- The user's side-by-side check against Guitar Pro, in the main and full-screen views, is done.
- No abandoned experiments or unused helpers remain in the diff.

---

## Risks

- **Narrow panels:** the fixed gutter takes a larger share of a narrow full-screen strip. Keep the gutter compact and check the narrowest layout during U4.
- **Wide bars reduce notes on screen:** note-value spacing makes dense bars wider. The compressed width scale in KTD1 and a final visual check on the fastest section of a real song limit this.
