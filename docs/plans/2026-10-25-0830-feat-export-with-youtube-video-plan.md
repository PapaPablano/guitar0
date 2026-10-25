# Export with the YouTube video visible

Status: draft, blocked on U0 (source for the rule). Nothing is implemented.

## Goal

An exported video looks like the live app: the selected views plus the docked YouTube player (200 by 200), with the video's audio.

## Why this is not a small change

1. The current export is an offline render. It draws frames from the app's own views onto an `OffscreenCanvas`, encodes them with a `VideoEncoder` and writes the mp4 with `mp4-muxer` (`src/export/encoder.worker.ts`, `src/export/exporter.ts`). It runs faster than real time and never touches the page.
2. The YouTube player is a cross-origin iframe playing live. It cannot be drawn into that canvas or stepped frame by frame.
3. The only way to get the dock's picture into a file is a live capture of the window while the song plays. That is a separate export mode, not an extension of the offline one.

## Conflict with the current plan

`docs/plans/2026-10-24-2230-feat-embedded-youtube-backing-plan.md` says the opposite:
- R11: exported videos never include YouTube audio or picture.
- AE5: an export with a video attached uses the synth or the loaded file's audio and shows no YouTube content.
- Out of scope: showing the video inside the exported file, which the embed's terms rule out.

The product owner's research disagrees with that. Those lines change in U0, and only once the source is recorded. YouTube's API Services terms, as understood when the earlier plan was written, restrict copying or re-encoding the embedded player's audio or video. The risk is takedown or loss of API access.

## Units

### U0. Record the rule and update the docs (gate)
- Add the source (policy text or platform rule that requires the video in exports) to this plan.
- Change R11 and AE5 in the embedded-backing plan, and add a line to `docs/launch-checklist.md`.
- Do not start U1 to U4 until this is done.

### U1. Prove capture works in both builds (spike)
- Test `navigator.mediaDevices.getDisplayMedia` in the web build and in the Tauri desktop shell (WebView2).
- Check that it captures the app's own window or tab, the dock's picture, and the embed's audio.
- Adjust `src-tauri/tauri.conf.json` permissions and CSP as needed.
- If the desktop shell cannot capture itself, stop and report. The fallback is a native capture path in `src-tauri`, a much larger job.

### U2. A "Record with video" export mode
- Offered only when a video is attached and Original audio is on.
- Starts playback from the tab's start and records with `MediaRecorder` while the dock and the selected views are on screen. Stops at the end of the tab or when the user stops it.
- The dock must stay visible, unobstructed and unminimized for the whole recording (R8).
- Saves through the existing `src/export/save-export.ts`.

### U3. Keep the offline export
- Synth and loaded-file audio keep using the offline render.
- The export dialog labels the two modes clearly.

### U4. Tests and checks
- Pure-function tests for mode selection: video attached plus Original selects record mode.
- Manual check in the web and desktop builds: the dock appears in the file, with audio, in sync.
- Confirm the dock cannot be minimized or dragged off screen during a recording.

## Trade-offs

- Recording runs in real time: a 4-minute song takes 4 minutes.
- Quality depends on window size and screen capture, below the offline render.
- The capture picker may ask the user to choose the window each time.
- The file contains YouTube's picture and audio, which is the risk named above.

## Open questions

- What is the source for the rule? (U0)
- Can the desktop shell capture itself? (U1)
