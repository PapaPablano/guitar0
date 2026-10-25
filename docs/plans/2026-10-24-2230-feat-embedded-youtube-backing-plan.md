---
title: Embedded YouTube Backing Track - Plan
type: feat
date: 2026-10-24
topic: embedded-youtube-backing
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Embedded YouTube Backing Track - Plan

## Goal Capsule

- **Objective:** Someone practising a tab can play along with the real recording from YouTube, with every view following it, without the app downloading or copying anyone's audio.
- **Means:** Play the video in YouTube's own embedded player and drive the app from a clock that follows it (KTD1, KTD2).
- **Product authority:** The user. Stem splitting of YouTube audio, YouTube audio in exports, and automatic alignment of YouTube audio are not active scope.
- **Open blockers:** None. One early check, whether YouTube accepts the embed inside the desktop shell, can stop the work (U1).
- **Execution profile:** Code. The embed check first (U1), then the clock (U2), link and offset memory (U3), search (U4), the app wiring (U5), and removal of the old path (U6). Done means the Definition of Done holds and a real video has been played against a real tab in the web build and the desktop build.
- **Tail ownership:** The implementer runs the work through local verification. Committing and opening a PR happen only when the user asks.

**Product Contract preservation:** Product Contract unchanged in scope. Two clarifications: the deferred question about the speed range is removed because planning resolved it (KTD4), and the Pro-gate assumption now says the remote switch does not carry over (KTD8).

---

## Product Contract

### Summary

A YouTube embed replaces the YouTube search, download and stem path. The player pastes a link or searches, and the video plays in a small docked player like Songsterr's, with an Original/Synth toggle that defaults to Original. The in-app play, pause, seek, speed and loop drive the video, and every view follows whichever audio is playing. The player lines the video up with the tab using an offset slider and a Sync here button.

### Problem Frame

Today a YouTube backing track is downloaded and split into stems on the desktop build only. That copies other people's content, which the player does not want the app doing. Songsterr shows the alternative: the video stays on YouTube's own player, and the tab follows it.

An embed gives play, seek and speed control but no access to its audio. The stem mixer, automatic alignment and mixed export audio cannot work on it, so the design has to keep those for the player's own files and make alignment manual for YouTube.

### Key Decisions

- **The embed replaces the YouTube search and download path.** Stems, the mixer and mixed export audio remain for files the player loads. Governs R1, R10. (session-settled: user-directed — chosen over dropping stems entirely and over keeping both paths: removes the content-rights exposure while keeping the player's own files fully featured.)
- **Both paste and search are offered.** Governs R2. (session-settled: user-directed — chosen over paste only and search only.)
- **Original/Synth toggle, defaulting to Original.** Governs R4. (session-settled: user-approved — chosen over defaulting to Synth and over video audio only.)
- **Manual alignment: offset slider plus Sync here.** Governs R6, R7. (session-settled: user-approved — chosen over slider only and Sync here only, since the embed's audio cannot be analysed.)

### Requirements

**Getting a video**

- R1. A tab can have a YouTube video attached as its backing track, and the old YouTube search, download and stem-splitting path is removed.
- R2. The player attaches a video by pasting a YouTube link or by searching inside the app, and search results show enough (title and length) to pick the right one.
- R3. The attached video is remembered for that tab and can be changed or removed.

**Playing**

- R4. With a video attached, the player toggles between Original (the video's audio) and Synth (the app's own band synth, video muted). Original is the default.
- R5. Play, pause, seek, speed and loop in the app drive the video, and the tab, waterfall, real guitar and pick views all follow whichever audio is playing.
- R8. While Original is playing, the video player stays visible and unobstructed in every view, and cannot be hidden or collapsed. In Synth mode it may be minimized.
- R9. When the app's speed is outside what the video can play, Original is unavailable or clamped, and the player is told why.

**Alignment**

- R6. The player sets the video's offset against the tab with the offset slider and fine nudges, saved per tab and video.
- R7. A Sync here button sets the offset from the moment the player has scrubbed the video to, as the tab's first note, saved per tab and video.

**Boundaries with existing features**

- R10. Loading a file, its stems, the mixer and mixed export audio keep working as today.
- R11. Amended 2026-10-25 (owner-directed, see `2026-10-25-0830-feat-export-with-youtube-video-plan.md`): a video export made in the "Record with video" mode shows the dock and carries the video's audio, as the live app does. The offline export, used for the synth and loaded-file audio, still never includes YouTube audio or picture. The owner took responsibility for the compliance call without a written source.

### Key Flows

- F1. Attach and play along
  - **Trigger:** The player opens the Backing track section on a tab.
  - **Steps:** Pastes a link or searches and picks a result; the video appears in the docked player; the player presses Sync here at the first note and nudges if needed; presses play.
  - **Outcome:** The tab and every view follow the video in Original; the toggle switches to Synth without losing position.
  - **Covered by:** R1, R2, R4, R5, R6, R7

### Acceptance Examples

- AE1. **Covers R4, R5.** Given a tab with a video attached and Original on, when the player switches to Synth mid-song, then the video mutes, the synth takes over at the same position, and the views keep moving.
- AE2. **Covers R8.** Given Original is playing, when the player changes view, then the video player is still on screen and uncovered.
- AE3. **Covers R9.** Given the app speed is below what the video can play, when the player is on Original, then the player sees a plain message and Original does not play at the wrong speed.
- AE4. **Covers R7.** Given the player scrubs the video to the first note and presses Sync here, when they press play, then the tab's first note lands with that moment in the video.
- AE5. **Covers R11.** Given a tab with a video attached, when the player exports a video, then the offline export uses the synth or the loaded file's audio and shows no YouTube content, and the "Record with video" export shows the dock and the video's audio.

### Scope Boundaries

- Stem splitting, the mixer and automatic alignment for YouTube audio are not possible on an embed and are out of scope.
- Loading the player's own file and its stems stay as they are.
- Auto-picking the right video for a tab is not part of this work.

#### Deferred to Follow-Up Work

- Auto-suggesting a video from the tab's title and artist.
- Showing the video inside the offline-rendered export. Superseded for the "Record with video" mode by R11 as amended.

### Dependencies / Assumptions

- Search needs a YouTube Data API key and quota, which the project does not hold today (unverified).
- The embed needs a network connection, and is assumed to work on the web build as well as desktop; the old path was desktop-only.
- The existing Pro gate on YouTube carries over, but not the desktop-only remote switch inside `youtubeAllowed` in `src/app/tier.ts`, which is false on web (KTD8). Pro gating is currently switched off in `src/app/tier.ts` (`isPro` returns true), so the feature is open to everyone until that is restored.
- The embed's rules require it to stay visible and unobstructed while audible; R8 depends on that.

### Outstanding Questions

**Deferred to Planning**

- How closely can the video and the app clock stay in step across loops and seeks, and is a visible resync needed? (Answered by measurement in U2.)
- Where does the YouTube Data API key live, and what happens when quota runs out? (Settled in KTD5 and U4; the key's provisioning is the owner's task.)

### Sources / Research

- `src/app/BackingTrack.tsx` and `src/app/backing-track.ts`: the current methods (`file`, `youtube`), with YouTube desktop-only and gated by `readYoutubeFlag()` and `youtubeAllowed`.
- `src/app/OffsetSlider.tsx` and `src/audio/offset-range.ts`: the existing offset slider and clamp, reused for R6.
- `docs/plans/2026-10-10-1750-feat-backing-track-setup-plan.md`: the plan that built the current Backing track section.
- Songsterr screenshot supplied by the user: docked player with a Full mix selector and an ORIG./SYNTH toggle.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **The video is a new `Clock`.** A clock that wraps the embedded player slots in beside the synth clock, the user-recording clock and the stem clock, which `src/app/App.tsx` already picks between (`stems?.clock ?? userClock ?? session?.clock`). Every view reads the clock, so R5 follows without touching them. The `Clock` interface and `PlaybackClock` are in `src/audio/clock.ts`.
- KTD2. **Original/Synth switches which clock the app uses, and the other one is parked.** Synth uses the existing `session.clock`; the video is muted and paused, then resumed at the same tab time when the player switches back. This mirrors how `activateStems` already hands position between clocks. Governs R4, R5. (see Key Decisions: Original/Synth toggle.)
- KTD3. **The video clock reuses the recording's alignment model.** It maps tab time to video time through `AlignmentMap.fromOffset` and `clampOffset`, the way `UserAudioClock` does, so the offset slider and its range work unchanged. It does not use the analysis, hold or exact-copy machinery, which needs audio. Governs R6.
- KTD4. **The embed plays only a fixed set of rates, so the clock follows the rate the player actually applied.** The app's tempo runs 25% to 125% in steps of 5, inside the embed's 0.25x to 2x range, but the embed offers only quarter-step rates, so a tempo such as 85% is not available. After every rate change the clock reads back the rate the player applied, interpolates at that effective rate, and tells the player plainly when it differs from the tempo they asked for. Governs R9.
- KTD5. **Search uses YouTube's official Data API, not scraping.** Results are ordered by closeness of length to the tab, reusing `rankByLength` from `src/app/stem-controls.ts`. Without a key, search is hidden and paste still works. Governs R2.
- KTD6. **Original needs a visible, unobstructed player (R8).** The player is a fixed dock outside the stage's views, and its hide control is disabled while Original plays. The full-screen panel (`src/app/PanelFullscreen.tsx`) is fixed over the whole page and requests browser full screen, so it would cover the dock; while a video is attached the dock is therefore rendered inside the full-screen panel too. Governs R8.
- KTD7. **The attached video and its offsets are remembered per tab in a separate small record,** keyed by the tab's fingerprint (`src/audio/tab-fingerprint.ts`) and holding the attached video's ID and an offset for each video ID used with that tab. It uses browser storage on web and desktop. The recording alignment stores cannot hold it: they accept only a recording's content hash as the key, and the desktop commands in `src-tauri/src/alignments.rs` reject any other key. Governs R3, R6, R7.
- KTD8. **The embed is gated by the build flag and the Pro check only,** not by the shell's remote YouTube switch, which exists only on desktop and is false on web, so it would hide the embed there. A new gate function replaces `youtubeAllowed` for the embed, and the method list stops requiring desktop for it. Governs R1.

### High-Level Technical Design

Which clock drives the app, and what plays:

| Source chosen | Clock the views follow | Audible | Video |
|---|---|---|---|
| Original | video clock | the embed | playing, visible (R8) |
| Synth | `session.clock` | band synth | muted, paused, may be minimized |
| No video | existing: stems, user recording, or synth | as today | none |

The video clock's time is the player's reported time run back through the offset map. Seek, rate, play and pause are forwarded to the player, and the loop wraps by seeking the player to the loop start when the reported time passes its end.

### Assumptions

- The embed's JavaScript API reports its position often enough (a few times a second) that the clock can interpolate between reports, the way `PlaybackClock` interpolates from a time source. If measurement in U2 shows otherwise, the loop-wrap and seek tolerances are revisited there.
- The desktop shell's content-security policy (`src-tauri/tauri.conf.json`) needs YouTube's frame, script, image and API origins added.
- YouTube's embed rules about visibility, size and no-hide are taken as stated in R8; the exact minimum player size is read from YouTube's current terms during U1, where the dock is built, not assumed here.
- On desktop the embed may be refused by YouTube because the shell's origin is not a normal web origin (unverified). U1 checks this first.

---

## Implementation Units

### U1. Embed check: the docked player in web and desktop

- **Goal:** Prove a YouTube video plays in a docked embedded player in both the web build and the desktop shell, and expose its position and controls, before anything is built on it.
- **Requirements:** R8; stops or confirms the Goal Capsule's open blocker.
- **Dependencies:** None.
- **Files:**
  - `src/app/YoutubePlayer.tsx` (new)
  - `src/app/youtube-player.ts` (new: loads the embed's API once and wraps one player)
  - `src-tauri/tauri.conf.json` (content-security policy)
  - `index.html` or `vite.config.ts` only if the web build needs a policy change
  - `src/app/app.css`
  - `tests/app/youtube-player.test.ts` (new)
- **Approach:**
  1. Add the frame, script, image and API origins the embed needs to the desktop policy, and nothing wider.
  2. Wrap the player behind a small interface (play, pause, seek, rate, mute, time, state) so the clock and tests can use a fake.
  3. Render it in a fixed dock outside the stage, so no view covers it, and inside the full-screen panel as well (KTD6).
  4. Place the dock in a corner as in the Songsterr reference, at or above the minimum size in YouTube's current terms, keeping the embed's own controls visible. In a window too narrow for the stage and the dock side by side, the dock keeps its size and the stage gives way.
  5. Run it in both builds with one real video, including from inside a full-screen panel. If the desktop build refuses the embed, stop and ask the user before any workaround (see Risks).
- **Execution note:** Smoke first. This unit is mostly wiring and policy; the proof is a video playing in each build, not unit coverage.
- **Patterns to follow:** The policy line and shell wiring in `src-tauri/tauri.conf.json`; `src/app/desktop.ts` for telling the builds apart.
- **Test scenarios:**
  - The wrapper reports the same position the fake player holds after a seek.
  - The wrapper loads the embed's script once when two players are created.
  - A player error (video unavailable or embedding disabled) surfaces as a plain message and not an exception.
  - The wrapper reports the list of playback rates the player offers.
- **Verification:** A real video plays and reports its position in the web build and in the desktop shell, including from a full-screen panel, or the unit stops with the refusal reported.

### U2. The video clock

- **Goal:** A `Clock` that follows the embedded player, so the app can drive and read it like any other source.
- **Requirements:** R4, R5, R6, R9; Covers AE1, AE3.
- **Dependencies:** U1.
- **Files:**
  - `src/audio/youtube-clock.ts` (new)
  - `tests/audio/youtube-clock.test.ts` (new)
- **Approach:**
  1. Implement `Clock` over the player interface from U1, with tab time read from the player's time through `AlignmentMap` (KTD3).
  2. Interpolate between the player's position reports from a time source, as `PlaybackClock` does, so views move smoothly.
  3. Wrap the loop by seeking the player to the loop start; correct a drifted landing the way `UserAudioClock` checks its landings, within one tolerance constant.
  4. After each rate change read back the rate the player applied, interpolate at that rate, and report a plain message when it differs from the requested tempo (KTD4).
  5. Provide a mute/park and resume-at-tab-time pair for KTD2.
- **Patterns to follow:** `src/audio/clock.ts` for the interface and clamps; `src/audio/user-audio.ts` for offset maps and landing checks.
- **Test scenarios:**
  - Covers AE1. Parking at tab time T and resuming returns the clock to T, with the player muted while parked.
  - Time reads the player's position minus the offset: with offset 2.0 and the player at 12.0, tab time is 10.0.
  - A negative position (player before the tab's start) holds tab time at 0 and does not seek below zero.
  - A loop whose end the player passes seeks back to the loop start once, not repeatedly.
  - Covers AE3. A requested 85% tempo, where the player offers only 0.75 and 1.0, runs at the rate the player reports, interpolates at that rate, and the clock reports why it differs.
  - Between two position reports at an applied rate of 0.75, tab time advances at 0.75 and not at the requested rate.
  - Seeking while playing keeps playing; seeking while paused stays paused.
  - Pause then play resumes from the paused tab time.
  - A seek the player lands more than the tolerance away from is corrected a bounded number of times, then left alone.
- **Verification:** The clock passes against a fake player, and a real-video measurement of seek and loop landing error is recorded in the unit's notes for the tolerance constants.

### U3. Link parsing and per-tab video memory

- **Goal:** Turn a pasted link into a video, and remember the video and its offset for a tab.
- **Requirements:** R2, R3, R6, R7; Covers AE4.
- **Dependencies:** U1.
- **Files:**
  - `src/app/youtube-link.ts` (new)
  - `src/app/youtube-sync.ts` (new: Sync here offset math)
  - `src/app/youtube-video-store.ts` (new: the per-tab record in KTD7)
  - `tests/app/youtube-link.test.ts` (new)
  - `tests/app/youtube-sync.test.ts` (new)
  - `tests/app/youtube-video-store.test.ts` (new)
- **Approach:**
  1. Parse the common link shapes (watch, short, embed, with and without extra parameters) into a video ID; reject anything else with a plain message.
  2. Compute the Sync here offset from the video's current position and the tab's first-note time. When the result is outside the range `clampOffset` allows, leave the offset unchanged and return a plain message; never store a clamped value silently.
  3. Save and restore the attached video and its per-video offsets through the new store in KTD7, which answers which video a tab has when it opens.
- **Patterns to follow:** `src/audio/offset-range.ts` for the range; `src/app/offset-controls.ts` for how offset changes are described; `src/app/pick-photo-store.ts` for a small browser-storage store.
- **Test scenarios:**
  - Each common link shape yields the same video ID; a link with a start-time parameter still yields it.
  - A non-YouTube link, an empty string and a playlist-only link are rejected with a message.
  - Covers AE4. With the video at 7.5 s and the tab's first note at 0 s, Sync here sets the offset to 7.5; with the first note at 1.0 s it sets 6.5.
  - Sync here with the video scrubbed to 45 s and the first note at 0 s leaves the offset unchanged and returns a message that the offset is out of range.
  - A saved offset is restored for the same tab and video, and not for the same tab with a different video.
  - Opening a tab returns the video last attached to it, and a tab with none returns nothing.
  - Removing the video clears the attachment for that tab.
- **Verification:** Link and sync logic pass; a saved offset survives reload in both stores.

### U4. In-app search

- **Goal:** Search YouTube by text and pick a result, through the official API.
- **Requirements:** R2.
- **Dependencies:** U3 (the picked result feeds the same attach path).
- **Files:**
  - `src/app/youtube-search.ts` (new: query and result mapping)
  - `src/app/stem-controls.ts` (reuse `rankByLength` and `searchRow`)
  - `src/app/BackingTrack.tsx` (search field and results; see U5)
  - `tests/app/youtube-search.test.ts` (new)
- **Approach:**
  1. Query the API for videos, then fetch lengths, and map to the existing result row shape (title, channel, length).
  2. Order results by closeness of length to the tab with `rankByLength`.
  3. Read the key from build configuration; with no key, report search unavailable and leave paste working.
  4. On a quota or network error, show a plain message and leave paste working.
- **Patterns to follow:** `rankByLength` and `searchRow` in `src/app/stem-controls.ts`; the build flag shape in `src/app/feature-flags.ts`.
- **Test scenarios:**
  - Results with lengths 180 s, 420 s and 240 s against a 230 s tab are ordered 240, 180, 420.
  - A result with no length sorts last and does not throw.
  - With no key configured, search reports unavailable and no request is made.
  - A quota-exceeded response yields a plain message, not an exception.
  - An empty result list yields an empty state.
- **Verification:** Search returns ordered results against the live API with a real key, and degrades cleanly without one.

### U5. Wire the Backing track section and the app

- **Goal:** The player's flow end to end: attach, align, toggle, play, export.
- **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11; Covers AE1, AE2, AE3, AE4, AE5; F1.
- **Dependencies:** U2, U3, U4.
- **Files:**
  - `src/app/BackingTrack.tsx`, `src/app/backing-track.ts`
  - `src/app/tier.ts` (the embed gate in KTD8)
  - `src/app/PanelFullscreen.tsx` (the dock inside the full-screen panel)
  - `src/app/App.tsx` (clock choice, export audio source, audio-source checks)
  - `src/app/OffsetSlider.tsx` (reused for the video's offset; add Sync here)
  - `src/app/practice-tools.ts`, `src/app/engine-state.ts` (if the section's availability rules change)
  - `tests/app/backing-track.test.ts`, `tests/app/practice-tools.test.ts` (extend)
  - `tests/app/youtube-wiring.test.ts` (new: clock choice and export source as pure functions)
- **Approach:**
  1. Replace the `youtube` method with an embed method available on web and desktop, gated as KTD8 says, and make `methodsFor` stop requiring desktop for it.
  2. Add the Original/Synth toggle, defaulting to Original, and hand position between clocks as in KTD2.
  3. Choose the clock as: video clock when a video is attached and Original is on, otherwise the existing order. Switching to the video clock pauses the loaded-file clock, the stem clock and the synth clock, handing position over as `activateStems` does; loading a file or stems while a video is attached parks the video.
  4. Treat an attached video as an audio source wherever `src/app/App.tsx` tests for `userClock || stems`: whether the offset tool and the play-along switch show, and which offset the slider displays.
  5. Make the export audio source ignore the video clock and use the synth or the loaded file (R11), and say so in the export dialog when a video is attached.
  6. Disable the dock's hide control while Original plays (R8).
  7. Show a state for each case in the Backing track section: no video (toggle and Sync here disabled), loading, attached (title, change and remove), invalid link, search unavailable, embed error, and a tempo the player cannot match. A player error during Original falls back to Synth with a visible message.
  8. Leave the embed's own controls visible so the player can scrub the video to find the first note for Sync here; the views follow the video's time while scrubbing, and Sync here pairs the video's current position with the tab's first-note time.
- **Patterns to follow:** `activateStems` in `src/app/App.tsx` for handing position between clocks; `src/app/backing-track.ts` for pure method helpers that tests can reach.
- **Test scenarios:**
  - Clock choice: video attached with Original gives the video clock; with Synth gives the synth clock; no video gives the existing order.
  - Covers AE5. Export audio source with a video attached and Original on is the synth, not the video.
  - Covers AE2. The dock's hide control is disabled while Original plays and enabled in Synth.
  - Methods offered: file always; the embed on web and on desktop when the build flag is on and the tier is Pro, whatever the shell's remote YouTube switch says; no embed when the flag is off.
  - Switching Original to Synth at tab time T and back resumes at T.
  - Attaching a video while stems or a loaded file are playing pauses them and resumes the video at the same tab time; loading a file while a video is attached parks the video.
  - A player error during Original switches to Synth at the same position and sets a message.
  - The dock is rendered inside the full-screen panel when a video is attached, and not when none is.
  - An attached video counts as an audio source, so the offset tool and play-along switch states match a loaded recording's.
  - Removing the video returns the app to its previous clock.
- **Verification:** A real video plays against a real tab with every view following it; toggling, seeking, looping and exporting behave as the acceptance examples say, in both builds.

### U6. Remove the old YouTube path

- **Goal:** No code downloads or splits YouTube audio.
- **Requirements:** R1, R10.
- **Dependencies:** U5.
- **Files:**
  - `src/app/StemPanel.tsx` (the YouTube search, import and take controls)
  - `src/app/take-align.ts` and `tests/app/take-align.test.ts` (take judging, now unreachable)
  - `src/stems/engine-client.ts` (the search call and result type, if nothing else uses them)
  - `src/app/App.tsx` (take records and handlers)
  - `src/app/feature-flags.ts`, `tests/app/feature-flags.test.ts` (remove `youtubeControls`; keep `readYoutubeFlag`, which gates the embed)
  - `src/app/tier.ts`, `tests/app/tier.test.ts` (remove `youtubeAllowed` and the remote `youtube` field once nothing reads them; keep `isPro`)
  - `engine/` and `src-tauri/` (the download command, if one exists; checked in this unit)
  - `docs/desktop-packaging.md`
- **Approach:**
  1. Remove the old search, import and take-judging code and the records it saved, keeping stems for loaded files untouched (R10).
  2. Check `engine/` and `src-tauri/` for the download path; remove it if nothing else uses it, or note what keeps it.
  3. Remove tests for removed code and keep every test for stems from loaded files.
  4. Update packaging notes so they no longer describe a downloader.
- **Execution note:** Remove only what the typechecker and tests show is now unused, and confirm stems for a loaded file still separate and mix.
- **Test scenarios:** Test expectation: none for removed behavior; the loaded-file stem tests in `tests/app/stem-controls.test.ts` and `tests/stems/` must still pass unchanged.
- **Verification:** The typechecker and full suite pass; a loaded file still separates into stems and mixes; a search of the source finds no download of YouTube audio.

---

## Verification Contract

| Gate | Command | Applies to |
|---|---|---|
| Typecheck | `npm run typecheck` | every unit |
| Unit tests | `npm test` | every unit |
| Build | `npm run build` | U1, U5, U6 |
| Web smoke | `npm run dev`, then play a real video against a tab and check every view | U1, U5 |
| Desktop smoke | run the desktop build and repeat the web smoke | U1, U5 |

## Definition of Done

- All units' verification holds and `npm run typecheck`, `npm test` and `npm run build` pass.
- A real YouTube video plays against a real tab in the web build and the desktop build, with the tab, waterfall, real guitar and pick views following it.
- Original/Synth, seek, speed, loop, offset, Sync here and export behave as AE1 to AE5 describe.
- No source downloads or splits YouTube audio, and abandoned experimental code from this work is removed.
- Stems, the mixer and mixed export audio for a loaded file work as before.

## Risks

- **The desktop shell may be refused by YouTube's embed.** The shell's origin is not a normal web origin, and YouTube sometimes refuses such embeds (unverified). U1 checks first; on refusal the work stops and the user decides (for example, web only).
- **Visibility rules are strict.** The player cannot be hidden or covered while audible (R8, KTD6). A later layout change that overlaps the dock would break the embed's terms.
- **Keyboard focus.** The embed's frame takes keyboard focus from the app's own shortcuts while it has focus; the new toggle, Sync here and results list also need keyboard and screen-reader access. This is checked in U5's smoke run.
- **Quota and key.** Search stops when the daily quota is spent or no key is set. Paste keeps working (KTD5).
- **Drift the app cannot measure.** The app cannot read the embed's audio, so a video that drifts against the tab (a live or re-edited version) is the player's to correct by hand, as the recording's offset note already says for recordings.
