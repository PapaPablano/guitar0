---
title: One Moment Object for Every View - Plan
type: feat
date: 2026-10-18
topic: one-moment-object
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# One Moment Object for Every View - Plan

## Goal Capsule

- **Objective:** Every view of a song agrees, at every instant, on which notes are sounding and which note is next, so the player never sees a note lit in one view and finished in another.
- **Means:** One shared per-frame snapshot, the Moment, that every view draws from (KTD1).
- **Product authority:** The user. The shared "now" colours and marker, a single look-ahead, the next-note cue on the highway and tab strip, seek from any view and the bar-timeline cursor mapping are separate ideas and not active scope.
- **Open blockers:** None.

## Product Contract

### Summary

A note counts as sounding for exactly its own length in the four views that light notes (the highway, fretboard, neck and pick views), on the page, in fullscreen and in the exported video. One shared snapshot of the current moment carries what is sounding, what is next, the playback bar and the loop range. The tab strip and bar timeline take their bar and loop from it, and a parity test checks that the four note-lighting views agree at fixed moments.

### Problem Frame

The views already share one clock but each decides for itself what "sounding" means. The repo has at least four different rules: the highway adds a 0.3 s minimum hold (`src/render/emphasis.ts`), the layout helper ends a note at `t < endSeconds` (`src/render/layout.ts`), the neck's cue model counts a note until `t <= endSeconds` and adds a linger (`src/render/neck-cue-model.ts`), and the fretboard and neck keep the last started step lit until the next one starts (`src/render/fretboard-steps.ts`). At every note boundary, which is where the eye is looking, the views can disagree.

### Key Decisions

- **A note is sounding for exactly its duration, with no minimum hold, no afterglow and no per-view timing.** Quick notes in fast runs may flash briefly, and the highway loses its 0.3 s hold. (session-settled: user-directed — chosen over a minimum hold, an afterglow, and per-view timing: the user picked strict timing with the tradeoff shown.) Governs R1, R3, R7.
- **During a gap, the dot views light nothing and show only the upcoming notes, dimmed.** The fretboard and neck stop holding the last note lit until the next starts. (session-settled: user-approved — chosen over a faint trail of the last note and over holding it fully lit: the user accepted the recommended option.) Governs R4, R5.
- **The neck view's slide trails keep their short finish after the note goes dark.** Slide comets run 0.2 s past the note's end while the note itself is not lit. The bend and pick effects end with the note today and keep doing so; the question put to the user described all three as lingering, which only slide comets do. (session-settled: user-approved — chosen over cutting trails off at the note's end: the user accepted the recommended option.) Governs R6.

### Requirements

**One definition of sounding**

- R1. A note is sounding from its start up to, but not including, its end, in every view, with no minimum hold.
- R2. Every view reads which notes are sounding, which step is next, the playback bar and the loop range from one shared per-frame Moment and does not decide this itself.
- R3. The page, the fullscreen view and the exported video build the Moment the same way, so a given time yields the same sounding set everywhere.

**Dot views**

- R4. When nothing is sounding, the fretboard, neck and pick views light no string and no note, show the upcoming notes dimmed, show neither the step just played nor a trail of earlier ones, draw no arrival pulse, and start the dashed path at the first upcoming step.
- R5. While any note is sounding, the dot views light every sounding note, as the highway does, and show the upcoming steps as they do today.

**Decoration and scope**

- R6. The neck view's slide comets keep running up to 0.2 s past a note's end, with the note itself not lit during that time; bend and pick effects end with the note, as today.
- R7. The on-the-beat swell, pop and halo are drawn only for a sounding note; the approach swell before a note starts is unchanged.
- R8. Look-ahead windows, string colours, panel layout and the tab strip's notation are unchanged by this work.

**Verification**

- R9. An automated parity check renders the highway, fretboard, neck and pick views at fixed moments and confirms each lights exactly the notes the Moment says are sounding.

### Acceptance Examples

- AE1. **Covers R1, R7.** Given a 50 ms note, when the time is 100 ms after its start, then the note is not lit or enlarged in any view (the old minimum hold would have kept it lit).
- AE2. **Covers R4.** Given two notes with a one-second rest between them, when the time is in the middle of the rest, then the fretboard, neck and pick views show no lit string or note, the second note appears dimmed as upcoming, and the highway has no gem on its strikeline.
- AE3. **Covers R1, R3.** Given a note from 2.0 s to 3.0 s, then at exactly 2.0 s it is sounding in every view and at exactly 3.0 s it is not, on the page and in an exported frame.
- AE4. **Covers R6.** Given a slide note ending at 5.0 s and followed by a rest, then at 5.1 s the note is not lit in the neck view while its slide comet still draws at reduced strength, and at 5.3 s the comet is gone.
- AE6. **Covers R5.** Given a long note still sustaining while a shorter later note starts and ends, then the long note stays lit in the highway and the dot views throughout, with no flicker when the short note ends.
- AE5. **Covers R3.** Given a repeat, when the time is just after the jump back, then every view's sounding set matches what the Moment reports for the repeated bar.

### Scope Boundaries

**Deferred for later**

- A shared "now" colour and marker across the highway, tab strip and bar timeline.
- One look-ahead that the highway also honours (it keeps its fixed 3 s window).
- The next-note cue on the highway and tab strip, and one shared note lifecycle.
- Click-to-seek and drag-to-loop from views other than the tab strip.
- Making the bar timeline cursor follow the tab strip's note-anchor mapping.
- Collapsing the export's duplicate panel dispatch into `drawSurface`.

### Success Criteria

- At every note start and note end in a test song, every note-lighting view (highway, fretboard, neck, pick) lights exactly the notes the Moment says are sounding, on the page and in an exported frame.
- Playing a fast run with two note-lighting views side by side, the player sees no note lit in one view and dark in the other.

## Planning Contract

### Key Technical Decisions

- KTD1. **`momentAt` is a pure function in a new `src/render/moment.ts`, called once per frame by each caller.** It has no DOM dependency, so the page loops (`src/app/Stage.tsx`, `src/app/PanelFullscreen.tsx`) and the export (`renderStageFrame`, which runs in `src/export/encoder.worker.ts`) all use it. Each renderer takes an optional `moment` option and falls back to `momentAt` when absent, which keeps the many tests that call renderers directly working while there is still only one definition. When a Moment is passed, its look-ahead wins and the renderer's own `lookahead` option is used only to build the fallback. `renderHighway`, which has no options object today, gains a trailing optional one so its positional callers do not change. Implements R2, R3.
- KTD2. **One predicate, `isSounding(note, t)`, is `start <= t < end`.** `layout.isActive` delegates to it so `noteX` and `techniques.ts` keep their call sites. Implements R1 under the strict-timing decision.
- KTD3. **Step semantics change in `stepsAt`, and the Moment adds the full sounding set.** `playing` becomes the latest started step if any of its notes is sounding, else null; `upcoming` is the steps starting after `t`; `trail` is the earlier steps only while `playing` is non-null, else empty. The Moment's `sounding` set holds every sounding note, including a long note from an earlier step, and the dot views light all of them. Implements R4, R5 under the gap decision.
- KTD4. **`emphasisAt` keeps its scale and pop curves but loses the minimum hold, and its `sounding` flag comes from `isSounding`.** Swell, pop and halo are therefore drawn only while a note truly sounds (R7). `MIN_HOLD_SECONDS` is removed. Implements R1, R7.
- KTD5. **The neck cue model keeps its 0.2 s slide-comet window, takes lit state from the Moment, and builds its note window independently of the dot-view steps.** `cuesAt` draws its candidate notes from the Moment's sounding set plus every note that ended within `COMET_LINGER_SECONDS`, plus the trail and upcoming steps, so a slide comet survives into a gap. The inclusive `<= endSeconds` test used for lit state is replaced; the comet timing windows stay, and bend and pick effects are not extended. Implements R6 under the slide-trail decision.
- KTD6. **The zoom camera is left alone.** `zoomedPlacement` follows the notes through a pure function of the notes and time (`followCentre`) and does not decide what is lit, so it is outside this change. Implements R8.

### Assumptions

- The on-the-beat swell, pop and halo remain each view's own decoration, drawn from the Moment's sounding state rather than becoming part of it. This was proposed in the scope summary and not explicitly confirmed.
- Lighting every sounding note in the dot views, including a long note held under a later step, is a change from today (only the latest started step is drawn as playing). It follows from the goal that every view agrees, but was not put to the user as its own question.

---

## Implementation Units

### U1. The Moment and the strict step rules

- **Goal:** Add the Moment and move the "sounding" and step rules into one place.
- **Requirements:** R1, R2, R4, R5; AE1, AE2, AE3.
- **Dependencies:** none.
- **Files:** `src/render/moment.ts` (new); `src/render/fretboard-steps.ts`; `src/render/layout.ts`; `tests/render/moment.test.ts` (new); `tests/render/fretboard-steps.test.ts`.
- **Approach:**
  1. Define the Moment (time, track, playback bar, the sounding notes, the playing step, the upcoming steps, the trail, look-ahead and loop) and `momentAt` in `src/render/moment.ts`, reusing `playbackBarIndexAt` from `src/model/bars.ts`.
  2. Define `isSounding` once (KTD2) and make `layout.isActive` delegate to it.
  3. Change `stepsAt` per KTD3 so `playing` is null in a gap and `trail` is empty then.
- **Execution note:** Rewrite the step tests to the new rule first (a rest now has no playing step), then change the code.
- **Patterns to follow:** the pure, cached helpers in `src/render/fretboard-steps.ts` (`groupSteps` with its `WeakMap`).
- **Test scenarios:**
  - Covers AE3. A note from 2.0 s to 3.0 s: `isSounding` is true at 2.0 s and false at exactly 3.0 s.
  - Covers AE2. Two notes with a rest between: in the middle of the rest `playing` is null, `trail` is empty and `upcoming` starts with the second note.
  - A chord (notes on one tick) is one playing step with all its notes sounding.
  - Before the first note `playing` is null and `upcoming` starts at the first note (the existing expectation survives).
  - The Moment's `playbackBar` is right on both sides of a repeat jump.
  - Look-ahead of 1 and of 8 still returns that many upcoming steps, and an out-of-range look-ahead is clamped as today.
- **Verification:** the Moment and step tests pass and no other code needs `MIN_HOLD_SECONDS` yet.

### U2. Highway and emphasis on the shared rule

- **Goal:** Make the highway and the shared swell use the strict rule.
- **Requirements:** R1, R7; AE1.
- **Dependencies:** U1.
- **Files:** `src/render/emphasis.ts`; `src/render/highway.ts`; `src/render/techniques.ts`; `tests/render/emphasis.test.ts`; `tests/render/highway.test.ts`; `tests/render/techniques.test.ts`.
- **Approach:**
  1. Remove `MIN_HOLD_SECONDS` from `emphasisAt` and take its `sounding` flag from `isSounding` (KTD4).
  2. In `highway.ts`, replace the local `emphasisAt(...).sounding` checks (the draw order, the lit strings and the hit effect) with the Moment's sounding set, and keep scale and pop from `emphasisAt` for the gem itself.
  3. Confirm `techniques.ts` still works through `isActive`.
- **Execution note:** Update `tests/render/emphasis.test.ts` first: its minimum-hold test asserts the old rule and becomes AE1.
- **Test scenarios:**
  - Covers AE1. A 50 ms note at 100 ms after its start has no sounding flag, no swell and no pop.
  - A one-second note is sounding and enlarged mid-way and back to scale 1 at its end.
  - The approach swell before a note starts is unchanged (the existing approach test passes as is).
  - The highway lights a string only while a note on it sounds, and a gem is pinned to the strikeline only while sounding.
  - A note that has ended is drawn as passed (faded) the instant it ends, with no hold.
- **Verification:** emphasis, highway and techniques tests pass.

### U3. Dot views on the shared rule

- **Goal:** Make the fretboard, neck and pick views light only what the Moment says, and show gaps as specified.
- **Requirements:** R4, R5, R6, R7; AE2, AE4.
- **Dependencies:** U1, U2.
- **Files:** `src/render/fretboard.ts`; `src/render/neck-view.ts`; `src/render/neck-cue-model.ts`; `tests/render/fretboard.test.ts`; `tests/render/neck-view.test.ts`; `tests/render/pick-view.test.ts`; `tests/render/neck-cue-model.test.ts`; `tests/render/neck-cues.test.ts` (including its assertion that a ring is still drawn after a note has ended, which encodes the old persisting step).
- **Approach:**
  1. Read the playing step, upcoming steps and trail from the Moment in `renderFretboard` and `renderNeckFrame` instead of calling `stepsAt` locally; the pick view goes through `renderNeckFrame`.
  2. Light strings and draw halo or ring only for notes in the Moment's sounding set, so a gap lights nothing (R4).
  3. In `neck-cue-model.ts` take lit state from the Moment and keep the 0.2 s trail windows for the comet cues (KTD5); check `drawOpenAndMuted` and the path pulse for any dependence on a persisting playing step.
  4. Rebuild `cuesAt`'s note window per KTD5 so slide comets, the arrival pulse and the finger poses for a note that just ended do not disappear when `playing` becomes null; with `playing` null draw no pulse and start the dashed path at the first upcoming step (R4).
  5. Light every note in the Moment's sounding set in the dot views (R5).
  6. Leave `zoomedPlacement` untouched (KTD6).
- **Execution note:** Start from a failing test for the gap case in `tests/render/fretboard.test.ts` (nothing lit mid-rest, next note dimmed).
- **Test scenarios:**
  - Covers AE2. Mid-rest, the fretboard and neck draw no halo and no lit string, the upcoming note is drawn dimmed, and no trail dots are drawn.
  - Covers AE4. A slide note ending at 5.0 s and followed by a rest: at 5.1 s no halo or lit ring for the note but the slide comet is drawn at reduced strength; at 5.3 s it is gone.
  - Covers AE6. A long note sustaining under a short later note stays lit in the fretboard and neck throughout, with no flicker when the short note ends.
  - Mid-rest the fretboard draws no arrival pulse and its dashed path starts at the first upcoming step.
  - A bend note's effect ends at the note's end (it does not linger), as today.
  - While a step sounds, the playing step is drawn lit with its halo and the upcoming steps follow, as before.
  - A chord lights all its strings together and stops all at once at the chord's end.
  - A hammer-on or pull-off ending note keeps its soft ring while sounding and loses it at its end.
  - The pick view and the neck view agree on the sounding set at the same moment.
- **Verification:** the fretboard, neck, pick and cue tests pass.

### U4. Build the Moment once per frame and pass it everywhere

- **Goal:** Make every caller build one Moment per frame and hand it to every view, on the page, in fullscreen and in the export.
- **Requirements:** R2, R3, R8; AE3, AE5.
- **Dependencies:** U1, U2, U3.
- **Files:** `src/app/panel-draw.ts`; `src/app/Stage.tsx`; `src/app/PanelFullscreen.tsx`; `src/render/stage-frame.ts`; `src/render/highway.ts`; `src/render/fretboard.ts`; `src/render/neck-view.ts`; `src/render/tab-strip.ts`; `src/render/bar-timeline.ts`; `tests/export/composite-views.test.ts`; `tests/export/export.test.ts`.
- **Approach:**
  1. Add an optional `moment` to each renderer's options (KTD1), falling back to `momentAt` when absent.
  2. Add the Moment to `PanelDrawState` in `panel-draw.ts` and build it once per frame in the `Stage.tsx` and `PanelFullscreen.tsx` draw loops, passing it through `drawSurface` to every surface.
  3. Build it once per frame in `renderStageFrame` for the export, and have the tab strip and bar timeline take their loop and playback bar from it.
  4. Leave the export's duplicate panel switch in place (deferred).
- **Test scenarios:**
  - Covers AE3. An exported frame at exactly a note's start has the note sounding and at exactly its end does not, matching the page.
  - Covers AE5. Just after a repeat jump the Moment's playback bar is the repeated bar and every view's sounding set matches it.
  - Passing a Moment explicitly and letting a renderer build its own give identical drawing calls.
  - A frame with the highway and tab strip, and one with the fretboard and bar strip, each build the Moment once (not once per panel).
  - The existing export tests still pass with their time-based expectations updated for the strict rule where they depended on the old hold.
- **Verification:** the export tests and the full suite pass, and a quick look at the page and fullscreen shows no change other than the agreed behaviour.

### U5. The parity test

- **Goal:** Lock the one-definition rule in with a test that catches any of the four note-lighting views drifting.
- **Requirements:** R9; AE1, AE2, AE3, AE4, AE5, AE6.
- **Dependencies:** U1, U2, U3, U4.
- **Files:** `tests/render/moment-parity.test.ts` (new); `tests/helpers/make-timeline.ts` only if a fixture needs a gap or a repeat.
- **Approach:**
  1. Build a small fixture with a chord, a 50 ms note, a one-second rest, a slide note, a long note held under a short later note, and a repeat.
  2. At a fixed list of moments (a note start, a note end, mid-note, mid-rest, mid-bend trail, just after the repeat jump) render the highway, fretboard, neck and pick views with the recording context and compare each view's lit result with the Moment's sounding set.
- **Execution note:** Pick the observation point per view from calls the recording context already captures (halo, ring and lit-string calls, the gem's x at the strikeline) rather than adding test-only hooks.
- **Test scenarios:**
  - At each fixed moment every view's lit set equals the Moment's sounding set.
  - Mid-rest, every view's lit set is empty.
  - With a long note held under a short later note, every view keeps the long note lit throughout.
  - The parity check passes both for a Moment built by the page path and for one built inside `renderStageFrame`.
- **Verification:** the parity test passes and fails when any one view's rule is changed.

---

## Verification Contract

| Check | Command or action | Proves |
|---|---|---|
| Types | `npm run typecheck` | The new Moment option compiles across the app, render and export code |
| Unit, render and export tests | `npm test` | Every unit's scenarios, including the rewritten old-rule tests and the parity test |
| Production build | `npm run build` | The change builds into the web bundle |
| Side-by-side look | Play a fast run with two views shown and look at a note boundary | Success criteria: no note is lit in one view and dark in the other |

## Definition of Done

- Every unit's test scenarios pass under `npm test`, and `npm run typecheck` and `npm run build` are clean.
- R1 to R9 hold, and the three settled decisions are visible in behaviour: strict timing, gaps showing only dimmed upcoming notes, and trails finishing for 0.2 s.
- The tests that asserted the old rules (minimum hold, a playing step that persists through a rest, the inclusive note end) are rewritten to the new ones, not deleted.
- Whether a note is lit is decided only through the Moment (checked in code review, with the parity test as the safety net), and `MIN_HOLD_SECONDS` is gone.
- No abandoned experiments remain in the diff.

---

## Risks

- **Fast runs can flash.** With no minimum hold, a note under about 50 ms is lit for only a frame or two. This was chosen knowingly; if it reads badly in practice, the rule can be changed in one place (`isSounding` and `emphasisAt`).
- **The dot views feel emptier in gaps.** Nothing stays lit between notes, so a slow passage shows more dark time than before; the dimmed upcoming note is the only cue then.
- **Many tests encode the old rules.** `tests/render/emphasis.test.ts`, `tests/render/fretboard-steps.test.ts` and the neck cue and export tests need rewriting; missing one would leave a test asserting the old behaviour.
