---
title: One Stage Renderer - Plan
type: feat
date: 2026-10-18
topic: one-stage-renderer
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# One Stage Renderer - Plan

## Goal Capsule

- **Objective:** A layout looks and behaves the same wherever it appears: on the page, in fullscreen and in the exported video.
- **Means:** One drawing path for all three surfaces and one rule for the bar strip.
- **Product authority:** The user. The shared "now" colours and marker, a single look-ahead, the next-note cue, seek from other views, and the export's panel choice and height split are not active scope.
- **Open blockers:** None.

---

## Product Contract

### Summary

The page, the fullscreen view and the exported video draw the stage through one path, so a layout looks the same in all three. One rule decides whether the slim bar strip shows: whenever no tab strip is on screen. The one visible change is in fullscreen, where the highway, neck and pick views gain the strip.

### Problem Frame

Three surfaces draw the same panels from different code. The page and fullscreen share `drawSurface` in `src/app/panel-draw.ts`, but the export has its own copy of the panel switch in `src/render/stage-frame.ts` and its own hardcoded background. The bar-strip rule exists in three forms: `needsBarStrip` for the page (`src/app/stage-layout.ts`), `withBar = panel === 'fretboard'` for fullscreen (`src/app/PanelFullscreen.tsx`), and `!panels.includes('tab')` for the export. As a result, fullscreen highway, neck and pick have no strip, so you cannot seek or loop from them, and any change to how a panel draws has to be made in more than one place and can drift.

### Key Decisions

- **The bar strip shows whenever no tab strip is on screen, on every surface.** Fullscreen follows the page rule. (session-settled: user-approved — chosen over keeping fullscreen's fretboard-only rule, over always showing the strip, and over dropping it from the export: the user accepted the recommended option.) Governs R1, R2, R3.

### Requirements

**One rule for the bar strip**

- R1. One rule decides whether the bar strip shows: it shows whenever no tab strip is on screen.
- R2. The page, the fullscreen view and the exported video all apply that rule. Fullscreen highway, neck, pick and fretboard show the strip; fullscreen tab strip does not.
- R3. In fullscreen the strip supports click to jump to a bar and drag to loop, as it does on the page, and tapping the main panel still toggles play.
- R4. The fullscreen play hint stays clear of the strip.

**One drawing path**

- R5. The page, the fullscreen view and the export draw each panel through the same drawing path, so a change to how a panel draws appears in all three.
- R6. Exported frames are visually unchanged by this work.

### Acceptance Examples

- AE1. **Covers R1, R2.** Given the highway, neck or pick view in fullscreen, then a bar strip runs along the bottom; given the tab strip in fullscreen, then it shows none.
- AE2. **Covers R3.** Given the highway in fullscreen, when the player clicks a bar on the strip the song jumps there, when they drag across bars a loop is set, and tapping the main panel still plays or pauses.
- AE3. **Covers R1, R2.** Given a stage of highway plus tab strip, then neither the page nor an export shows the strip; given highway plus fretboard, then both show it.
- AE4. **Covers R6.** Given each existing export layout, then its frames match those produced before the change.
- AE5. **Covers R4.** Given a paused fullscreen panel with the strip showing, then the "press space to play" hint sits above the strip and does not overlap it.

### Scope Boundaries

**Deferred for later**

- A shared "now" colour and marker across the highway, tab strip and bar timeline.
- One look-ahead that the highway also honours.
- The next-note cue on the highway and tab strip.
- Click-to-seek and drag-to-loop from the other views on the page.
- The export's choice of panels and its equal-height split.
- Making the bar timeline cursor follow the tab strip's note positions.

### Success Criteria

- A given layout shows the same panels and the same bar strip on the page, in fullscreen and in the exported video.
- Existing export frames do not change.
- The bar-strip rule lives in one place.

### Dependencies / Assumptions

- Exported frames staying visually unchanged was proposed in the scope summary and not explicitly confirmed. Any change to an existing export frame counts as a regression unless the user says otherwise.
- The page, fullscreen and export keep their own sizing: the page and fullscreen draw into canvases sized by the browser, and the export draws into an offscreen frame whose height it splits equally.

### Outstanding Questions

**Deferred to Planning**

- How one drawing path serves both the page's canvases and the export's offscreen frame, which clips and translates each panel into its slice.
- How the fullscreen strip's height, and the play hint's position, are derived from the shared layout instead of the hardcoded `bottom: 76` in `src/app/PanelFullscreen.tsx`.

### Sources / Research

- `src/app/panel-draw.ts` (`drawSurface`) and `src/render/stage-frame.ts` (`renderStageFrame`, `frameLayout`): the two drawing paths.
- `src/app/stage-layout.ts` (`needsBarStrip`), `src/app/PanelFullscreen.tsx` (`withBar`), `src/render/stage-frame.ts` (`!panels.includes('tab')`): the three forms of the strip rule.
- `docs/ideation/2026-10-18-visual-sync-of-views-ideation.html`, idea "One stage renderer for page, fullscreen and export".

---

## Planning Contract

Product Contract unchanged.

### Key Technical Decisions

- KTD1. **One pure `drawPanel` in the render layer draws a panel into any context.** It takes a `PhotoContext` (the context the neck frame already needs), the panel kind, the size and one input object (timeline, track, time, loop, look-ahead, label mode, technique cues, photo, pick photo, moment). `drawSurface` keeps its canvas fitting and the page's photo shapes and then calls it; `renderStageFrame` keeps its layout, background, translate and clip and calls it per region. The two switches in `src/app/panel-draw.ts` and `src/render/stage-frame.ts` already pass identical options, so merging them changes no drawing. Implements R5.
- KTD2. **The bar-strip rule is one small dependency-free function, `needsBarStrip`, in a new `src/app/bar-strip.ts`.** `src/app/stage-layout.ts` re-exports it so existing imports and tests keep working, and `renderStageFrame` imports it from the new module. The export worker bundles `stage-frame.ts`, and `stage-layout.ts` pulls in browser storage, so the rule cannot live there for the export to use. Implements R1, R2.
- KTD3. **Fullscreen asks one function which surfaces to draw: `surfacesFor(panel)`.** It returns the panel and, per the rule, the bar strip. The same list decides which canvases render and which draw in the fullscreen loop, so the rule cannot drift from what is drawn, and it is testable without a browser. Implements R2, R3.
- KTD4. **The strip height and the play hint offset share one CSS variable.** `.panel-fullscreen canvas.bar-timeline` and the hint's offset both read it, replacing the hardcoded `bottom: 76` in `src/app/PanelFullscreen.tsx`. Implements R4.
- KTD5. **Export frames are characterized before anything changes.** U1 records a hash of the drawing calls of exported frames for the existing layouts on the unchanged code and commits it; every later unit must keep it green. Implements R6, AE4.

### Assumptions

- The export keeps its own stage background (`#101216`), its equal-height split and its panel choice, as the Product Contract scopes out.
- Fullscreen's slim strip stays 56 px tall, as it is today for the fretboard.

---

## Implementation Units

### U1. Lock in today's export frames

- **Goal:** Capture the current export output so the refactor can be proved not to change it.
- **Requirements:** R6; AE4.
- **Dependencies:** none.
- **Files:** `tests/export/export-frames-golden.test.ts` (new).
- **Approach:**
  1. Render exported frames with the recording context for the layouts the app offers (single panel for each of the five views, highway plus tab strip, highway plus fretboard, tab strip plus neck, neck plus pick) at several times, including a note start, mid-rest and a loop.
  2. Hash the recorded calls of each frame and compare it with a committed table of hashes.
  3. Generate the table by running the test once on the unchanged code and committing the result with the test.
- **Execution note:** Capture the hashes first, on the code as it stands, before any other unit edits a source file.
- **Patterns to follow:** the frame-rendering helpers in `tests/export/composite-views.test.ts`.
- **Test scenarios:**
  - Covers AE4. Each layout and time renders to the same hash as the committed one.
  - The same layout at the same time hashes the same on two renders (the hashes are stable).
  - Changing the look-ahead or label mode changes the hash (the test can tell frames apart).
- **Verification:** the golden test passes on the unchanged tree and fails if a panel's drawing is altered.

### U2. One bar-strip rule

- **Goal:** Replace the three forms of the rule with one function used by the page, fullscreen and export.
- **Requirements:** R1, R2; AE1, AE3.
- **Dependencies:** U1.
- **Files:** `src/app/bar-strip.ts` (new); `src/app/stage-layout.ts`; `src/render/stage-frame.ts`; `tests/app/stage-layout.test.ts`; `tests/app/bar-strip.test.ts` (new).
- **Approach:**
  1. Move `needsBarStrip` into `src/app/bar-strip.ts` unchanged in behaviour (true when no panel is the tab strip) and add `surfacesFor(panel)` (KTD3).
  2. Re-export `needsBarStrip` from `src/app/stage-layout.ts` so `src/app/Stage.tsx` and the existing test keep working.
  3. Have `renderStageFrame` call it instead of `!panels.includes('tab')`.
- **Patterns to follow:** the existing `needsBarStrip` test at `tests/app/stage-layout.test.ts`.
- **Test scenarios:**
  - Covers AE3. Highway plus tab strip needs no strip; highway plus fretboard needs one; neck plus pick needs one.
  - Covers AE1. `surfacesFor` returns the panel and the bar strip for highway, fretboard, neck and pick, and only the panel for the tab strip.
  - A single panel layout follows the same rule as a two-panel one.
  - The rule is imported from the new module by the export path, and the golden export test still passes.
- **Verification:** the stage-layout, bar-strip and golden export tests pass.

### U3. One drawing path

- **Goal:** Draw panels for the page, fullscreen and export through one function.
- **Requirements:** R5, R6; AE4.
- **Dependencies:** U1.
- **Files:** `src/render/draw-panel.ts` (new); `src/app/panel-draw.ts`; `src/render/stage-frame.ts`; `tests/render/draw-panel.test.ts` (new).
- **Approach:**
  1. Add `drawPanel` per KTD1, covering the five panels and the bar strip, with the option shapes now duplicated in `drawSurface` and `renderStageFrame`.
  2. Make `drawSurface` fit the canvas, adapt the page's `PickPhoto` to the shared shape, and call `drawPanel`.
  3. Make `renderStageFrame` call `drawPanel` inside each clipped region and delete its own switch.
  4. Keep `frameMoment` and `withMoment` where they are; the moment still arrives in the input object.
- **Execution note:** Keep U1's golden test green after each step; a changed hash means the merge altered drawing.
- **Patterns to follow:** the options already passed in `drawSurface` and `renderStageFrame`.
- **Test scenarios:**
  - Covers AE4. U1's golden export frames are unchanged.
  - Drawing a panel with `drawPanel` into a recording context produces the same calls as the export draws inside that panel's region (apart from the region's save, translate and clip).
  - Each of the five panels and the bar strip is dispatched to its own renderer, with the look-ahead, label mode, technique cues, photo and pick profile passed through.
  - The pick view falls back to the bundled profile when no pick photo is given, as before.
  - A moment passed in the input reaches the renderer unchanged.
- **Verification:** the draw-panel and golden export tests pass, and `src/render/stage-frame.ts` no longer imports the individual panel renderers.

### U4. The strip in fullscreen

- **Goal:** Show the bar strip in fullscreen by the shared rule, with a play hint that stays clear of it.
- **Requirements:** R2, R3, R4; AE1, AE2, AE5.
- **Dependencies:** U2, U3.
- **Files:** `src/app/PanelFullscreen.tsx`; `src/app/app.css`.
- **Approach:**
  1. Replace `withBar = panel === 'fretboard'` with the result of `surfacesFor(panel)`, and use that list for both the canvases rendered and the surfaces drawn each frame.
  2. Keep the strip's existing click-to-jump and drag-to-loop handlers and the main panel's tap-to-play.
  3. Define the strip height as a CSS variable, use it for the strip and for the hint's offset through a class, and remove the inline `bottom: 76`.
  4. Update the component's doc comment, which still says only the fretboard keeps a strip.
- **Patterns to follow:** the fretboard's existing strip in `PanelFullscreen.tsx`.
- **Test scenarios:**
  - Covers AE1. Fullscreen highway, neck, pick and fretboard render and draw the strip; fullscreen tab strip does not (via `surfacesFor`, tested in U2).
  - Test expectation: none for the CSS and component wiring -- there is no component test setup in the repo; AE2 and AE5 are checked by hand.
- **Verification:** typecheck and build pass, and by hand in the app: open each view in fullscreen, click a bar to jump, drag to loop, tap the panel to play, and check the paused hint sits above the strip.

---

## Verification Contract

| Check | Command or action | Proves |
|---|---|---|
| Types | `npm run typecheck` | The shared drawing function and the moved rule compile across `src/app`, `src/render` and `src/export` |
| Unit and export tests | `npm test` | The rule, the shared drawing path and, through the golden test, that exported frames did not change |
| Production build | `npm run build` | The export worker still bundles with the new imports |
| Fullscreen by hand | Open highway, tab strip, fretboard, neck and pick in fullscreen in the running app | AE1, AE2 and AE5: strip present where the rule says, seek and loop work, hint clear |

## Definition of Done

- Every unit's test scenarios pass under `npm test`, and `npm run typecheck` and `npm run build` are clean.
- R1 to R6 hold, and the golden export frames from U1 are unchanged.
- The three forms of the bar-strip rule are gone, replaced by one function; `src/render/stage-frame.ts` and `src/app/panel-draw.ts` share one panel-drawing function.
- The fullscreen hand check in the Verification Contract is done for all five views.
- No abandoned experiments or unused helpers remain in the diff.

---

## Risks

- **Fullscreen loses 56 px.** The strip takes vertical space from fullscreen highway, neck and pick, which matters most on a short landscape phone screen. The fretboard already accepts this.
- **A refactor that must not change a frame.** Merging two switches could subtly change an option; the golden test in U1 is the guard, so it has to be captured before anything else changes.
- **No component test for fullscreen.** The wiring in `PanelFullscreen.tsx` is covered only by the pure `surfacesFor` test and the hand check.
