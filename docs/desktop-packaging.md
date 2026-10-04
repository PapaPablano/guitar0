# Desktop packaging

The desktop app is Tab Highway's page inside a small Tauri shell, plus a pinned copy of the StemDeck engine that separates a recording into stems. The web site is unchanged; stem features appear only in the desktop app. Windows only.

## What is in the package

```text
TabHighway.exe          the shell (src-tauri)
python/                 StemDeck's Windows Python runtime, from the pinned release
backend/                StemDeck's backend, unmodified, from the pinned release
engine/                 Tab Highway's wrapper (engine/wrapper): cross-origin allowance and secret check
data/                   first-launch downloads, saved stems, logs (created at run time)
```

The shell starts the engine as `uvicorn tabhighway_engine:app` on a free loopback port, with a fresh secret for every launch. The wrapper (`engine/wrapper/guard.py`) allows only the shell's own page origin to call the engine and rejects any request without the secret. Nothing in StemDeck's code is changed.

## First launch

The package carries the Python runtime. On first launch the app offers a one-time setup that downloads FFmpeg (checked against the checksum its host publishes) and runs StemDeck's model warm-up, which fetches the Demucs model and StemDeck's other models into `data/`. After that, separation works offline.

## Build

Requirements: Node, Rust, and the Tauri CLI (`cargo install tauri-cli --version "^2"`).

```powershell
scripts/package-windows.ps1
```

The script builds the page and the shell, downloads the StemDeck release named in `engine/stemdeck.version`, checks it against the checksum StemDeck publishes, and stages the package under `dist-desktop/`. To update StemDeck, change the tag in that file and run the saved-stems flow once by hand.

## Tests

- Page logic: `npm test` and `npm run typecheck`.
- The wrapper: `python -m pytest engine/tests` (needs `starlette`, `httpx` and `pytest`).
- The shell and the package are checked by hand; see the manual pass in the plan, `docs/plans/2026-10-04-0945-feat-desktop-stem-separation-plan.md`.

## Licences

`THIRD_PARTY_NOTICES.md` covers the page and is shown in the web app, so it stays free of desktop-only items. `packaging/windows/THIRD_PARTY_NOTICES.md` covers what the desktop package adds (StemDeck, Demucs, FFmpeg, Tauri) and ships as `THIRD_PARTY_NOTICES-desktop.md`. The package also ships StemDeck's own notices (`THIRD_PARTY_NOTICES-stemdeck.txt`), which cover its Python runtime and libraries.
