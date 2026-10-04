# Third-party notices

Tab Highway bundles the packages and assets below. Each keeps its own licence.

## Packages shipped in the page

### @coderline/alphatab 1.8.4

- Licence: Mozilla Public License 2.0 (MPL-2.0).
- Source: https://github.com/CoderLine/alphaTab
- Used unmodified, for parsing Guitar Pro and MusicXML files, tick and tempo timing, and sound synthesis. MPL-2.0 applies to alphaTab's own files; they are not changed here.
- alphaTab itself includes these libraries:
  - TinySoundFont, MIT, Copyright (C) 2017, 2018 Bernhard Schelling
  - SFZero, MIT, Copyright (C) 2012 Steve Folta
  - Haxe Standard Library, MIT, Copyright (C) 2005-2025 Haxe Foundation
  - SharpZipLib, MIT, Copyright (C) 2000-2018 SharpZipLib Contributors
  - NVorbis, MIT, Copyright (c) 2020 Andrew Ward
  - libvorbis, BSD-3-Clause, Copyright (c) 2002-2020 Xiph.org Foundation

### react 19.3.0, react-dom 19.3.0, scheduler 0.28.0

- Licence: MIT. Copyright (c) Meta Platforms, Inc. and affiliates.
- Source: https://github.com/facebook/react

### mp4-muxer 5.2.2

- Licence: MIT. Copyright (c) 2023 Vanilagy.
- Source: https://github.com/Vanilagy/mp4-muxer
- Writes the MP4 container for video export. The package is no longer developed; its author points to Mediabunny (MPL-2.0) as the successor.

## Assets shipped in the page

### Sonivox SoundFont (sonivox.sf3)

- Supplied with alphaTab in `@coderline/alphatab/dist/soundfont/`.
- Its licence file states Apache License 2.0, Copyright (c) 2004-2006 Sonic Network Inc.
- Its README describes it as based on the Sonivox EAS synthesizer from the Android Open Source Project. The file's chain of custody is not fully documented, so check its provenance before wide distribution.

### Bravura music font

- Supplied with alphaTab in `@coderline/alphatab/dist/font/`.
- Licence: SIL Open Font License 1.1. Copyright (c) 2015, Steinberg Media Technologies GmbH, with Reserved Font Name "Bravura".

### Sample riff

- A short original riff written for this project, included so first-time visitors can try the tool.

## Not used

- No code from Slopsmith (AGPL-3.0) is used. It is a visual reference only.
- No code from Clone Hero Chart Studio is used. The highway renderer was written for this project.

## Development tools (not shipped)

Vite, Vitest, TypeScript, `@vitejs/plugin-react` and `@coderline/alphatab-vite` (MPL-2.0) are used at build time only.
