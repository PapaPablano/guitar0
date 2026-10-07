---
title: Player Layout Redesign - Plan
type: feat
date: 2026-10-07
topic: player-layout-redesign
execution: code
---

# Player Layout Redesign - Plan

## Goal

Make reading one tab, start to finish, calmer. The header carries three things (track, view, export). Tuning is one chip. Practice tools show one at a time. The main page shows two panels at once, and the player picks which two: any pair from highway, tab strip, fretboard diagram and the real-guitar neck photo.

Source: the "Guitar0 Tab Viewer Redesign" design canvas and its audit (read from source, not tested in a browser). Work lands on a new branch off `feat/neck-highway-style`, one commit per phase.

## What the design leaves out

The mockup shows only the tab and the neck. The real stage today is the **highway** on top (flex 3) with either the tab strip or the fretboard diagram below (flex 2 / 3). There is also a separate full-screen **real-guitar neck** (photo, zoomed, with technique cues) that is not on the main page at all.

This plan replaces the fixed layout with **two selectable panels**:

| Panel | Today | Source to draw it |
| --- | --- | --- |
| Highway | always on top | `renderHighway` |
| Tab strip | bottom option | `renderTabStrip` |
| Fretboard | bottom option | `renderFretboard` (+ bar timeline) |
| Real neck | full screen only | `drawNeckPhoto` + `renderNeckView` (zoomed) |

Any two of the four make a pair (six pairs). One panel alone is also allowed, for a full-height view. The default stays highway over tab strip, so nothing changes for anyone who does not touch it.

## Phases

Each phase ships on its own and leaves the app working.

### Phase 1 - Header and tuning (P1)

- Header keeps `TrackPicker` as tabs, the view switch and Export. Full screen stays as an icon button until phase 3d replaces it with a button on each panel, so the app never loses it in between.
- "Find on Songsterr" and "Open another file" move into a More menu. Use a native `<details>` or a small popover with real buttons and `aria-label`s; no div buttons.
- Merge `FileTuningPicker` and `TuningPicker` into one `TuningChip` that opens a sheet with "Written in" and "Show in". Keep `file-tuning-options.ts` and `onFileTuningChange` as they are; only the UI changes.
- Open another file: keep the one-click behaviour for now. First read `scheduleProfileSave` and `restore-profile.ts` to see whether alignment and mix are already saved on exit. Add a confirm only if work would be lost.
- Files: `App.tsx` (header block, ~lines 773-815), `TrackPicker.tsx`, `TuningPicker.tsx`, `FileTuningPicker.tsx`, new `TuningChip.tsx`, new `MoreMenu.tsx`, `app.css`.
- Tests: extend `file-tuning-options.test.ts` only if the option logic moves; add a render-free test for any new pure helper.

### Phase 2 - One practice tool at a time (P1)

- New `PracticeTools.tsx` holds a chip row (Loop, Sections, Recording, Stems, Alignment) and renders only the chosen panel. Panels reuse `LoopControls`, `SectionPanel`, `OffsetSlider`, `StemPanel`, `AlignmentPanel` unchanged.
- Chips for Sections, Stems and Alignment appear only when their panel can render today (`userClock || stems`, `sections.length > 0`). Alignment keeps its status text visible on the chip when it needs attention, so a failed run is not hidden behind a tab.
- Notices and errors (`notice`, `error`, `ExactnessStrip`) stay outside the tabs, always visible.
- Remember the last open tool per session in component state; no persistence.
- Files: `App.tsx` (lines ~850-930), new `PracticeTools.tsx`, `app.css`.
- Tests: a pure helper `availableTools(flags)` in `practice-tools.ts` with a unit test for which chips show.

### Phase 3 - Two selectable panels (P1)

Split into three steps, each testable.

**3a. Layout model (pure, no UI).** New `src/app/stage-layout.ts`:
- `type PanelId = 'highway' | 'tab' | 'fretboard' | 'neck'`; `type StageLayout = { top: PanelId; bottom: PanelId | null }`.
- `DEFAULT_LAYOUT = { top: 'highway', bottom: 'tab' }`, `normaliseLayout(raw)` (rejects unknown ids, and a repeated id falls back to the default), `swapPanels`, `setPanel(layout, slot, id)` (picking the id the other slot has swaps them, so the player never gets a duplicate).
- `needsBarStrip(layout)`: true when neither panel is the tab strip, so seek and loop always have a bar surface (the slim bar timeline, as the fretboard view has today).
- `loadLayout()` / `saveLayout()` following the `neck-cues-setting.ts` pattern, wrapped in try/catch.
- Tests: `tests/app/stage-layout.test.ts` covers every pair, swap, the duplicate rule, bad stored values, and `needsBarStrip`.

**3b. Draw the real neck on the page.** Pull the photo load and the per-frame draw out of `NeckFullscreen.tsx` into shared code (`useNeckPhoto()` and `drawNeckPanel(ctx, ...)`), then have both full screen and the stage call it. No behaviour change in full screen. The Techniques toggle shows in the real-neck panel as a small button, since `neckCues` state already lives in `App.tsx`.

**3c. Stage and picker.**
- `Stage.tsx` takes a `layout` prop and renders one canvas per chosen panel, each `flex: 1`, plus the bar strip when `needsBarStrip`. Each canvas gets its own draw branch in the existing animation loop (the loop already branches on `bottomView`).
- Pointer handling: seek and loop-drag stay on the tab strip and the bar strip only. `barFromEvent` picks whichever of the two is on screen.
- `ViewControls.tsx` becomes a "Panels" control: two selects, "Top" and "Bottom" (Bottom has "None"), plus a Swap button and three presets: Highway + Tab, Highway + Neck, Tab + Neck. The label and "Notes ahead" controls show whenever the fretboard or neck panel is on screen.
- `BottomView` in `render/composite.ts` is untouched, so the video export is unaffected. The export dialog keeps its own tab or fretboard choice.
- Files: new `stage-layout.ts`, `Stage.tsx`, `ViewControls.tsx`, `NeckFullscreen.tsx` (becomes `PanelFullscreen.tsx`), new `canvas-fit.ts`, `App.tsx` (replace `bottomView` state with `layout`, and `neckFullscreen` with the full-screen panel id or null), `app.css` (remove the fixed `.highway` / `.strip` / `.fretboard` flex ratios in favour of one equal split), `tests/app/view-controls.test.ts`.
- Check by hand: all six pairs plus single panel, drag-to-loop in each pair that has a bar surface, resize, and that a panel switch mid-drag does not leave a stuck drag (the existing reset on view change must now key on the layout).

**3d. Full screen for any panel.** Today `NeckFullscreen.tsx` is the only full-screen view. Generalise it so every panel has the same option.
- Rename to `PanelFullscreen.tsx` taking a `panel: PanelId`. It keeps what the neck version already does: enter the browser's fullscreen, Esc and the fullscreen-change event close it, tap or Space plays, and the hint shows while paused.
- Each panel in the stage gets a small corner button (`aria-label` "Full screen <panel name>"). The header button is removed in this step; the shortcut `F` opens the top panel full screen and pressing it again, or Esc, closes it.
- Drawing: the full-screen view calls the same per-panel draw function the stage uses (3b/3c), so there is one draw path per panel and no copy to drift. Pull `fitCanvas` out of `Stage.tsx` into a shared `canvas-fit.ts` and use it in both places in place of the inline copy in `NeckFullscreen.tsx`.
- Per-panel behaviour in full screen:
  - Highway and real neck: tap toggles play. The real neck keeps its Techniques toggle.
  - Tab strip: click a bar to jump and drag to loop, as on the page (the tab strip handlers move into a shared hook used by both).
  - Fretboard: shows the slim bar strip along the bottom, so seeking and looping still work (`needsBarStrip` already covers this case).
- Controls in full screen: the fretboard and neck panels keep their label mode and "Notes ahead" controls in a small overlay; play and the close button stay as they are.
- Tests: add to `stage-layout.test.ts` that every `PanelId` has a full-screen entry (name, label, whether it needs a bar strip). The behaviour itself is checked by hand: open each of the four in full screen, play, seek, loop, exit with Esc and with the button.

### Phase 4 - Transport, shortcuts, naming (P2)

- Seek bar shows section labels and the loop band when loop is on. Data already exists (`sections`, `loop`); `Transport.tsx` takes them as props.
- Shortcut legend under the tools row. Build it from the same table the key handler uses (see `App.tsx` ~lines 700-736) so the two cannot drift. If the table is inline today, lift it into `shortcuts.ts` first.
- "Notes ahead" becomes a 1 to 8 stepper (`clampLookahead` already limits it).
- Files: `Transport.tsx`, `ViewControls.tsx`, `App.tsx`, new `shortcuts.ts`, `app.css`.
- Tests: `shortcuts.test.ts` checks every handled key has a legend entry.

### Phase 5 - Narrow windows (P2)

- Add the first media queries to `app.css`: below about 900px the header wraps to two rows, track tabs scroll sideways, the tools row scrolls, and the transport keeps a 44px touch target.
- Touch targets: raise buttons in the header, transport and tools to 44px high.
- No logic changes. Check by resizing the window in the dev server at 1280, 900, 600 and 390px wide.

### Phase 6 - Look (P3)

- Move colours into the existing `:root` tokens: add `--accent-warm` (amber), `--accent-cool` (teal) next to `--accent`. Do not restyle canvases in this phase; `render/theme.ts` owns canvas colours, and changing it alters exported video. Treat canvas colours as a separate decision.
- Typeface: the mockup uses Manrope and JetBrains Mono. The app uses the system font and ships offline on desktop (`desktop.ts`), so bundle the font files under `src/assets` rather than loading from Google Fonts.

## Verification

- `npm run typecheck`, `npx vitest run`, `npm run build` after each phase.
- A real look in the dev server after phases 1, 2, 3 and 5: open the sample, switch tracks and views, open each tool, load a recording, resize the window. Unit tests cover the helpers but not how it looks.
- Keyboard: tab through the header, More menu, tuning sheet and tools row; every control reachable and visibly focused.

## Risks

- **Equal split may be too small for the tab strip or neck.** Each panel is half of an `88vh` stage, so give the tab strip and neck a minimum height and let the stage grow (the page already scrolls). A draggable divider is a later step if people want it.
- **Two canvases drawing every frame.** The real neck draws a photo plus overlays each frame. Watch frame time with neck + highway on a laptop; if it drops, draw the neck at a lower resolution scale.
- **Hiding tools hides problems.** A failed alignment or a loading stem must still show on its chip or in the always-visible notices.
- **Pointer handling in Stage.** Three canvases sharing one drag state is where regressions would show; keep the existing unmount-on-switch reset (`useEffect` on the view) and test drag in each view by hand.
- **Fonts.** Loading from a CDN breaks offline desktop use.

## Open questions

1. Should the video export follow the on-page pair, or keep its own tab or fretboard choice (the plan keeps it)?
2. Should Open another file confirm, or stay one click once the profile check in phase 1 is done?
3. Is changing canvas colours (`render/theme.ts`) wanted, given it changes exported video?

## Order and size

Phases 1 to 3 are the P1 findings and the value of the redesign; 4 to 6 are polish. Rough size: phase 1 and 2 are a day each, phase 3 about four days (3a half a day, 3b one day, 3c one and a half, 3d one), phases 4 and 5 about a day each, phase 6 half a day.
