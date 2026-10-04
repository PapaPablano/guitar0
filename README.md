# Tab Highway

Practice a Guitar Pro or MusicXML tab as a scrolling highway over a synced tab strip, entirely in the browser. Your files stay on your device.

- Drop a `.gp3`–`.gpx` or MusicXML file, or try the bundled sample riff.
- Play with the built-in sound, slow it down, and loop bars (drag across bars on the strip, or use the bar fields).
- Load your own recording and line it up with an offset slider.
- Desktop Chrome and Edge also export the highway as an MP4. Other desktop browsers support practice only. Phones and tablets are not supported yet.

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
