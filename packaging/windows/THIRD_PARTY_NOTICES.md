# Third-party notices: desktop app additions

These apply to the Windows desktop package only. The page's own notices are in THIRD_PARTY_NOTICES.md, also included.


### StemDeck 0.17.2 (engine, unmodified)

- Licence: Apache License 2.0.
- Source: https://github.com/stemdeckapp/stemdeck
- Runs stem separation on the user's machine. The package ships StemDeck's Python runtime and backend as released; Tab Highway adds only a wrapper in `engine/wrapper`.
- StemDeck's own notices for the Python runtime, its libraries, Demucs and FFmpeg ship with the package as `THIRD_PARTY_NOTICES-stemdeck.txt`.

### Demucs (htdemucs_6s model)

- Licence: MIT. Copyright (c) Meta Platforms, Inc. and affiliates.
- Source: https://github.com/facebookresearch/demucs
- Downloaded on first launch.

### FFmpeg (BtbN Windows build)

- Licence: GPL (the `gpl` build variant). Source and licence terms: https://github.com/BtbN/FFmpeg-Builds
- Downloaded on first launch and run as a separate program by the engine.

### Tauri 2

- Licence: Apache-2.0 or MIT. Source: https://github.com/tauri-apps/tauri
- The desktop shell.
