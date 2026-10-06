---
title: Neck Photo Calibration - Plan
type: feat
date: 2026-10-06
topic: neck-photo-calibration
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

## Goal Capsule

- **Objective:** A player sees their own guitar in the full-screen neck view and in exported video, with the note rings landing on its frets and strings, without a code change.
- **Product authority:** The user's confirmed scope in the brainstorm dialogue. Bass, seven-string and left-handed guitars, and a library of photos, are not active scope.
- **Open blockers:** None.

---

## Product Contract

### Summary

The player replaces the bundled guitar photo with their own by tapping six points in order on it: the nut, the 12th fret and the bridge, each on both edges of the neck. The positions the neck view draws against move out of code into a profile per photo, and the bundled photo ships as the default profile. A preview shows rings on a sample chord, with Done or Redo. The calibrated photo is the current neck photo for both the full-screen view and video export, and is remembered.

### Problem Frame

The neck view draws glowing rings over one bundled photo, with the nut, 24 fret positions, the bridge and the string heights all measured by hand for that photo and held in code. Showing the player's own guitar means measuring a new photo and changing code.

The player's own photo is a top-down shot of the neck with the body edge and pickups slightly visible, like the bundled one. Photos like that are taken at a mild angle, so frets bunch up and strings converge along the neck.

### Requirements

**Photos and profiles**

- R1. Each neck photo has a profile holding where the nut, the frets, the bridge and the strings sit on that photo, which is what the neck view and video export draw against.
- R2. The bundled photo ships with its existing positions as the default profile, so with no photo chosen the neck view and export look as they do today.
- R3. The player can choose a photo of their own and calibrate it.

**Calibration**

- R4. Calibration asks for six taps in order, each with its own prompt: the nut, the 12th fret and the bridge, each at the high-E side and the low-E side of the neck.
- R5. The app fits the fret positions from the taps with the standard fret-spacing rule, including photos taken at a mild angle where frets bunch up and strings converge.
- R6. After the sixth tap a preview draws rings for a sample chord over the photo, with Done and Redo. Redo restarts the taps. There is no adjusting of individual frets.
- R7. Nothing changes until Done: leaving calibration midway keeps the photo and calibration that were in use.

**Using the photo**

- R8. The calibrated photo is the current neck photo for both the full-screen neck view and video export.
- R9. The current photo and its calibration are remembered between sessions.
- R10. The player can go back to the bundled photo.
- R11. A note on a fret beyond the last fret visible in the photo is drawn at the last visible fret, as today.

### Key Decisions

- **Six guided taps, one prompt at a time, then a preview** (session-settled: user-directed — chosen over dragging a default grid onto the neck and over four quick taps with nudging: every step is unambiguous and the fit does not depend on judging a grid). Governs R4, R6.
- **One current photo for everything** (session-settled: user-directed — chosen over a library of calibrated photos and over choosing each time: the choice stays out of the way and the player's guitar shows wherever the neck does). Governs R8, R9, R10.
- **Cover other six-string side-on photos and angled photos first** (session-settled: user-directed — chosen over also covering bass, seven-string and left-handed guitars in this version: the first photo to calibrate is a top-down six-string, and angle handling is needed to make it land on the frets). Governs R5.

### Acceptance Examples

- AE1. **Covers R3, R4, R5, R6.** Given a top-down photo of a six-string neck, when the player taps the six points as prompted, the preview shows rings on the right frets and strings, and Done makes it the current photo.
- AE2. **Covers R6.** Given a preview whose rings sit off the frets, Redo restarts the six taps from the first.
- AE3. **Covers R7.** Given a calibration abandoned after three taps, the photo and calibration in use before it are unchanged.
- AE4. **Covers R8, R9.** Given a calibrated photo, the full-screen neck view and an exported video both use it, and it is still the current photo after the app is reopened.
- AE5. **Covers R2, R10.** Given no photo chosen, or after going back to the bundled one, the neck view and export look as they do today.
- AE6. **Covers R5.** Given a photo taken at a mild angle where the strings converge toward the bridge, the rings follow the converging strings and the narrowing frets.
- AE7. **Covers R11.** Given a note on a fret past the last one the photo shows, the ring is drawn at the last visible fret.

### Success Criteria

- For a photo like the bundled one, the rings of a played note sit between the right fret wires and on the right string, to the eye, along the whole visible neck.
- A player with a photo can calibrate it in about a minute without help.
- Using a different six-string photo needs no code change.

### Scope Boundaries

- Not covering bass, seven-string or left-handed (headstock right) guitars in this version.
- Not covering steeply angled photos or heavy lens distortion.
- Not detecting the neck in a photo automatically.
- Not adjusting individual frets after the taps; the preview offers Redo only.

#### Deferred to Follow-Up Work

- Bass, seven-string and left-handed guitars.
- A library of several calibrated photos to switch between.
- Fine adjustment of a calibration after the taps.

### Dependencies / Assumptions

- Assumption: the player's photo shows the whole neck, including the 12th fret and the bridge, which the six taps need.
- Assumption: the tab's track has six strings; a track with a different string count keeps drawing as it does today.

### Outstanding Questions

#### Deferred to Planning

- How the fit uses six taps to place 24 frets and the string lines when the photo is at a mild angle, and how far from straight-on a photo can be before the fit fails.
- Where a calibrated photo and its profile are stored on the desktop and on the web, and any limits on photo size.
- Where calibration is started in the interface, and what the sample chord in the preview is.
- How a photo that cannot be loaded or has no usable taps falls back to the bundled photo.

### Sources / Research

- `src/render/neck-view.ts` holds the nut, the 24 fret positions, the bridge and the string heights measured for one 1120 by 491 photo, and the view placement derived from them.
- `src/export/neck-photo.ts` loads the bundled photo for export, and `src/app/NeckFullscreen.tsx` loads it for the live view.
- `docs/ideation/2026-10-05-neck-view-and-recording-sync-ideation.html`, idea 5, describes this work, including the later bass, seven-string and left-handed goal.
