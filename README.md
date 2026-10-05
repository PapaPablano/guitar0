# Tab Highway

Practice a Guitar Pro or MusicXML tab as a scrolling highway over a synced tab strip, entirely in the browser. Your files stay on your device.

- Drop a `.gp3`–`.gpx` or MusicXML file, or try the bundled sample riff.
- Play with the built-in sound, slow it down, and loop bars (drag across bars on the strip, or use the bar fields).
- If a file's frets are written for a tuning other than the one it says (a song played a half step down, saved as standard), set "File is actually tuned to". Fret numbers stay as written; the open strings, the built-in sound and the fretboard note names follow. "Show in tuning" is different: it keeps the sound and moves the frets.
- Switch the bottom panel between the tab strip and a fretboard view. The fretboard shows the playing note as a solid dot, a dashed path to the next few notes (you choose how many, 1 to 8) and a fading trail, with a slim bar timeline underneath for looping and jumping. Exported videos use whichever view is selected.
- Search Songsterr from the start screen, or jump to it from a loaded tab. This only opens their site in a new tab; the app makes no requests to Songsterr and never touches their tab files.
- Load your own recording and line it up with a two-way offset slider (up to 30 s either way) with 10 ms and 100 ms nudge buttons; the label says whether the recording starts later or earlier than the tab.
- Desktop Chrome and Edge also export the highway as an MP4. Other desktop browsers support practice only. Phones and tablets are not supported yet.

Video export uses WebCodecs, which browsers only enable on secure pages: the deployed site (https) and `localhost` work, a plain `http://` address on a network does not. Export covers the whole song at its original tempo, up to 10 minutes; loops and tempo changes apply to practice only.

## Desktop app (Windows)

A Windows desktop build adds stem separation: load your recording, split it into vocals, drums, bass, guitar, piano and other on your own machine, then mute the guitar to play along, solo it to check phrasing, or mix the stems into the exported video. Separated songs are saved and reopen without re-processing. You can also search YouTube from the app and import a song's audio directly (only use audio you have the right to use), and turn any stem from 0 to 200% of its original level. It uses a bundled copy of [StemDeck](https://github.com/stemdeckapp/stemdeck) and needs a one-time download of FFmpeg and the separation models on first launch. The web site has no stem features. See `docs/desktop-packaging.md` to build it.

## Develop

```bash
npm install
npm run dev        # local server
npm test           # unit tests
npm run typecheck
npm run build      # static site in dist/
```

The site is static and deploys to GitHub Pages through `.github/workflows/deploy.yml` on pushes to `main`. In the repository settings, set Pages to deploy from GitHub Actions.

## How it fits together

- `src/model` wraps alphaTab's output in our own immutable `Score` and `Timeline` types. Nothing under `src/render` imports alphaTab.
- `src/render` draws the highway and tab strip as pure functions of a timeline and a time.
- `src/audio` holds the clocks: the synth-backed clock and the user-recording clock.
- `src/app` is the React shell.

## Licences

See `THIRD_PARTY_NOTICES.md` (also shown in the app under "Licences"). alphaTab is MPL-2.0 and is used unmodified.
