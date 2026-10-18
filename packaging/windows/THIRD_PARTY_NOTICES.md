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

### UVR-MDX-NET Karaoke 2 (vocal split model)

- Licence: MIT. Credit: Ultimate Vocal Remover (UVR) and its developers (Anjok07 and contributors), as the `audio-separator` project asks.
- Source: https://github.com/Anjok07/ultimatevocalremovergui
- Downloaded on first use of the lead/backing vocal split, through `audio-separator` (MIT).

### LGPL libraries in the Python runtime

- `lameenc` 1.8.4 (LGPL-3.0-or-later) and `soxr` 1.1.0 (LGPL-2.1-or-later, the python-soxr binding of libsoxr).
- They are shipped unmodified as separate loadable modules in `python/Lib/site-packages/`, so a player can replace them with their own build of the same library.
- Source: https://github.com/Dobiasd/lameenc and https://github.com/dofuuz/python-soxr

### Removed from the package

- `diffq-fixed` (CC BY-NC 4.0, non-commercial) comes with StemDeck's runtime. `scripts/package-windows.ps1` deletes it, because Demucs needs it only for quantized checkpoints and the `htdemucs_6s` model is not one. The same script runs `scripts/check-licences.py` and stops the build if any package in the runtime has a non-commercial or unrecognised licence.

### FFmpeg (BtbN Windows build)

- Licence: GPL (the `gpl` build variant). Source and licence terms: https://github.com/BtbN/FFmpeg-Builds
- Downloaded on first launch and run as a separate program by the engine.

### Tauri 2

- Licence: Apache-2.0 or MIT. Source: https://github.com/tauri-apps/tauri
- The desktop shell.
