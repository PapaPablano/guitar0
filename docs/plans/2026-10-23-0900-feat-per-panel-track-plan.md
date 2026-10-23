---
title: Per-Panel Track - Plan
type: feat
date: 2026-10-23
topic: per-panel-track
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Per-Panel Track - Plan

## Goal Capsule

- **Objective:** Someone practising with a band file can watch two tracks at once, such as a bass neck over a guitar neck, live and in the exported video, the way they already watch two views of one track.
- **Means:** Store an optional track for the bottom slot with the layout, and draw each panel from its own track on the page, in full screen and in the export (KTD1, KTD2).
- **Product authority:** The user. Per-panel mute or play-along, new mixing controls, and auto-pairing bass with guitar are not active scope.
- **Open blockers:** None.
- **Execution profile:** Code. Pure model first (U1), then the shared frame renderer (U2), then the page (U3) and the export (U4). Done means the Definition of Done holds and a bass over guitar pair has been looked at live and in an exported frame.
- **Tail ownership:** The implementer runs the work through local verification. Committing and opening a PR happen only when the user asks.

**Product Contract preservation:** Product Contract unchanged.

---

## Product Contract

### Summary

Each of the two stage slots can show a different track. The bottom slot has a track chooser that defaults to "Same as the picker". Any view can sit in either slot with any track. Playback, looping, tuning and tone stay with the main picker. The exported video draws each panel with its own track.

### Problem Frame

The stage shows two views, but both follow the single track chosen in the track picker. A player learning a bass line and a guitar part together cannot see both necks, because choosing one track changes both panels. A 4-string track already draws on the bass photo, so a bass neck over a guitar neck is the natural pairing, and today it is impossible.

### Key Decisions

- **Any view may show any track in either slot.** Chosen over a dedicated two-necks preset and over same-view-only pairs. Governs R1, R2. (session-settled: user-directed — chosen over a two-necks-only preset and a same-view mirror: one rule covers bass over guitar, tab over highway, and anything else.)
- **The main picker keeps driving everything that is not drawing.** Tuning, tone, looping, the bar strip and play-along stay with the picker's track; the slot chooser only changes what a panel draws. Governs R3, R5. (session-settled: user-directed — chosen over always-independent slots and an auto-pair preset: least change to controls that already work.)
- **Sound is unchanged.** The full band plays as it does today, and play-along still silences one track. Governs R6. (session-settled: user-directed — chosen over silencing both tracks and a per-panel mute: no new mixing controls.)

### Requirements

**Choosing a track per slot**

- R1. The bottom slot has a track chooser whose default is "Same as the picker"; picking another track makes that slot draw it.
- R2. The top slot follows the main picker. Any view works in either slot with any track, including a bass track on the bass photo and a guitar track on the guitar photo at once.
- R3. Changing the main picker moves the top slot and any slot left on "Same as the picker", and leaves a slot with its own track alone.
- R4. A slot's own track choice is remembered with the layout, and falls back to "Same as the picker" when the track no longer exists in the open song.

**Playback and export**

- R5. Seeking, looping, the bar strip, tuning, tone and play-along keep using the main picker's track.
- R6. The sound is unchanged by the slot choices.
- R7. The exported video draws each panel with its own track, matching the live page, in full screen and in both export shapes.

### Acceptance Examples

- AE1. **Covers R1, R2, R7.** Given a song with a guitar and a 4-string bass track, when the top slot shows the guitar's Real guitar view and the bottom shows the bass, the live page and the exported video both draw the guitar photo above the bass photo, each with its own track's notes.
- AE2. **Covers R3.** Given the bottom slot is on its own track, when the picker changes track, the bottom slot keeps its track and the top slot changes.
- AE3. **Covers R4.** Given a bottom slot set to track 3 and a song that has two tracks, when it opens, the slot shows "Same as the picker".
- AE4. **Covers R7.** Given both slots on "Same as the picker", every exported frame is identical to what it was before this change.

### Success Criteria

- A guitar and a bass track are watched together on the page and in an exported video, and each neck matches its own track, checked on a real frame and not only in tests.
- A song with one slot per view on the same track behaves exactly as today.

### Scope Boundaries

- Per-panel mute, per-panel play-along, and mixing controls are out.
- A one-click bass plus guitar pairing is out; the player picks the tracks.
- Showing a recorded video of someone playing next to a view is a different feature and is out.
- Tuning, tone, looping and the bar strip do not follow the bottom slot's track.

### Outstanding Questions

#### Deferred to Planning

- How the vertical waterfall columns and full screen lay out two different tracks (header or label per panel).
- Whether a slot needs a visible label when its track differs from the picker.

### Sources / Research

- `src/app/stage-layout.ts` holds the two-slot layout, its presets and storage; `src/render/stage-frame.ts` takes one `trackIndex` for all panels.
- `src/app/ExportDialog.tsx` and `src/export/exporter.ts` carry one `trackIndex` to the export.
- `docs/plans/2026-10-22-0418-feat-bass-neck-photo-plan.md` makes a 4-string track draw on the bass photo, which this feature pairs with a guitar neck.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The layout stores an optional `bottomTrack` (a track index, absent when none).** Absent means "Same as the picker". The top slot has no stored track because it always follows the picker (R2, R3). A pure `trackForSlot(layout, slot, pickerTrack, trackCount)` returns the track each slot draws, and returns the picker's track when the stored one is out of range (R4). `normaliseLayout` accepts old saved layouts without the field. A track belongs to its slot: moving or swapping views leaves each slot's track where it was.
- KTD2. **Rendering takes one track per panel, not one per frame.** `renderStageFrame` and `drawSurface` receive a per-panel list of track indices alongside `panels`. A frame builds one `Moment` per distinct track, so two panels on the same track still share one moment, and a frame with both slots on the picker's track is identical to today's (AE4).
- KTD3. **Photos are chosen per panel from that panel's track.** The neck photo kind comes from `neckPhotoKind(stringCount)` of the panel's own track, so a frame may need both the guitar and the bass photo. The page already loads both (`useNeckPhoto()` and `useNeckPhoto('bass')`). The frame options carry a photo per kind in place of the single `photo`, and the export loads whichever kinds the panels need.
- KTD4. **The export serializes the notes of every track a panel draws.** `serializeTimeline` takes a list of track indices and fills `notes` for each; `hydrateTimeline` already reads notes by index. The start message carries the per-panel tracks. Audio is unchanged (R6).
- KTD5. **Everything that is not drawing keeps the picker's track.** Bar selection, looping, the bar strip, tuning, tone and play-along are not touched (R5). The retuned timeline applies to the picker's track only, so a bottom track draws from the file's own tuning; this follows R5.
- KTD6. **The slot chooser sits in the bottom panel's tool row**, a compact select shown only when the song has more than one playable track, like `TrackPicker`.

### Technical Design

This illustrates the intended shape and is directional guidance, not code to copy.

    layout     = { top, bottom, bottomTrack }
    slotTracks = [picker, trackForSlot(layout, bottom, picker, trackCount)]   // one per shown panel
    frame(t)   = per distinct track: moment = momentAt(timeline, track, t)
                 per panel i: draw(panel, slotTracks[i], moments[slotTracks[i]], photoFor(panel, slotTracks[i]))

### Risks

- A Free install swaps Pro views for free ones through `layoutForTier`. The swap must keep `bottomTrack` on the slot, or a swapped view silently changes track.
- The waterfall columns path (highway beside tab in a vertical frame) draws both columns from one track today and needs a track per column.
- The export worker receives only the notes `serializeTimeline` sends, so a track missing from that list shows as an empty panel with no error. A test pins it.

---

## Implementation Units

### U1. Layout carries a bottom-slot track

- **Goal:** Store and resolve a track per slot with no drawing change.
- **Requirements:** R1, R2, R3, R4.
- **Dependencies:** None.
- **Files:** `src/app/stage-layout.ts`, `src/app/tier.ts`, `tests/app/stage-layout.test.ts`, `tests/app/tier.test.ts`.
- **Approach:** Add `bottomTrack` to `StageLayout` and `DEFAULT_LAYOUT` (`null`). Extend `normaliseLayout` to keep a non-negative integer, drop anything else, and drop it when `bottom` is `null`. Add `trackForSlot`. Make `setPanel` and `swapPanels` leave each slot's track in place. Make `layoutForTier` keep the track on the slot.
- **Test scenarios:** An old saved layout without the field loads with `null`. A stored negative or fractional value becomes `null`. `trackForSlot` returns the picker track for `null`, the stored track when it exists, and the picker track when the stored index is past the last track (AE3). Swapping panels leaves each slot's track in place. A Free install swapping a Pro view in the bottom slot keeps the bottom track. A one-panel layout has no bottom track.
- **Verification:** The layout and tier tests pass, and the existing ones pass unchanged.

### U2. The frame renderer draws each panel from its own track

- **Goal:** `renderStageFrame` and the waterfall columns take a track per panel and a photo per kind.
- **Requirements:** R2, R7.
- **Dependencies:** U1.
- **Files:** `src/render/stage-frame.ts`, `tests/export/composite-views.test.ts`, `tests/export/waterfall-columns.test.ts`, `tests/export/stage-frame-unchanged.test.ts`.
- **Approach:** Replace the single `trackIndex` argument with a per-panel track list; a single number stays accepted and means every panel, so existing callers keep working until U3 and U4 move. Build one `Moment` per distinct track. Pick each neck photo and profile from the panel's track through `neckPhotoKind` and `neckProfileFor`. Give `drawWaterfallColumns` the track for each column.
- **Test scenarios:** Covers AE1: a guitar neck over a bass neck draws the guitar photo above the bass photo, each with its own notes. Covers AE4: both slots on one track draw the same calls as before. Two panels on one track share one moment. Highway beside tab in a vertical frame draws each column from its own track. A pick view on a 4-string track uses the bass photo while a 6-string track in the other slot uses the pick photo.
- **Verification:** The frame tests pass, including the unchanged-frame test.

### U3. The page and full screen draw per panel and offer the chooser

- **Goal:** The live page and full screen show each panel's track, with a chooser in the bottom slot.
- **Requirements:** R1, R2, R3, R5.
- **Dependencies:** U1, U2.
- **Files:** `src/app/Stage.tsx`, `src/app/PanelFullscreen.tsx`, `src/app/panel-draw.ts`, `src/app/use-bar-select.ts`, `src/app/App.tsx`, `src/app/SlotTrackPicker.tsx` (new), `src/app/app.css`, `tests/app/panel-draw.test.ts` (new), `tests/app/slot-track-picker.test.ts` (new).
- **Approach:** `drawSurface` and `withMoment` take the panel's track. `Stage` builds each panel's state with its own moment from `trackForSlot`. `surfaceLabel` already names the track, so each canvas reads its own. `PanelFullscreen` opens with the track of the panel it was opened from. `App` passes the layout's `bottomTrack` and an `onBottomTrackChange` that saves through the existing `setLayout`. The chooser lists playable tracks plus "Same as the picker". Loop and seek state stay the picker's, but a tab strip showing another track maps a click to a bar through that track's own strip layout, so `barAtPointer` and `useBarSelect` take the panel's track for the tab panel.
- **Test scenarios:** Covers AE2: after a picker change the bottom slot keeps its own track. The chooser lists the playable tracks and the default, and is absent for a single-track song. A canvas label names its own track. Full screen from the bottom panel draws the bottom track. Choosing the picker's own track stores `null`. A click on a bottom tab strip showing another track selects the bar under the pointer in that track's layout.
- **Verification:** The tests pass, and a real two-track file shows a guitar and a bass neck together in the browser.

### U4. The export draws each panel from its own track

- **Goal:** The exported video matches the page, with the notes and photos each panel needs.
- **Requirements:** R6, R7.
- **Dependencies:** U1, U2.
- **Files:** `src/model/serialize.ts`, `src/export/exporter.ts`, `src/export/encoder.worker.ts`, `src/app/ExportDialog.tsx`, `tests/export/export.test.ts`, `tests/export/composite-views.test.ts`, `tests/model/serialize.test.ts` (new if absent).
- **Approach:** `serializeTimeline` takes the list of tracks to include. `startExport` and the start message carry the per-panel tracks and a photo per kind. `ExportDialog` computes the tracks from the layout, loads each needed neck photo kind (guitar, bass, or both), and closes the ones it opened on cancel or failure, as it does now.
- **Test scenarios:** Covers AE1: a start message for a guitar-over-bass pair carries both photos and both tracks' notes. Serializing two tracks round-trips both note lists through `hydrateTimeline`. A cancelled export closes both photo bitmaps. Both slots on the picker's track send the same message as before apart from the new fields (AE4). The audio in the message is unchanged.
- **Verification:** The export tests pass, and a real exported frame of a bass over guitar pair has been looked at.

---

## Verification Contract

- `npm test` passes, including the unchanged-frame test.
- `npm run build` type-checks and builds.
- By hand: open a file with a guitar and a 4-string bass track, put the Real guitar view in both slots, choose the bass in the bottom chooser, play, open full screen from each panel, and export one landscape and one vertical video; look at a frame of each.

## Definition of Done

- R1 to R7 hold and AE1 to AE4 are covered by tests.
- A song with both slots on the picker's track behaves exactly as before, on the page and in the export.
- The bass-over-guitar pair has been looked at live and in an exported frame.
- Code or tests from approaches that did not pan out are removed from the diff.
