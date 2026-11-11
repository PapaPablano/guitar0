# FreePats sound banks

Four banks from the FreePats project (http://freepats.zenvoid.org/), each dedicated to the public domain under
Creative Commons CC0 1.0 Universal. The full CC0 text is in `FreePats_CC0_License.txt` beside this file; the four
original archives carry identical copies.

| File here | Plays as (GM program) | FreePats bank | Source archive |
|---|---|---|---|
| `FreePats_EGuitarFSBS_Clean.sf3` | 27 Electric guitar (clean) | Electric Guitar FSBS (clean), bridge small, version 2026-08-07. Sampled from a Fender electric guitar. | https://github.com/freepats/electric-guitar-FSBS-clean/releases/download/2026-08-07/EGuitarFSBS-clean-bridge-small-SF2-20260807.7z |
| `FreePats_EGuitarFSBS_Dist2.sf3` | 30 Distortion guitar | Electric Guitar FSBS (dist2), bridge, version 2022-09-11. Sampled from a Fender electric guitar. | https://github.com/freepats/electric-guitar-FSBS-dist2/releases/download/2022-09-11/EGuitarFSBS-dist2-SF2-20220911.7z |
| `FreePats_FingerBassYR.sf3` | 33 Electric bass (finger) | Finger Bass YR, version 2019-09-30. Samples by Andrea Biasior from a Yamaha RBX bass, edited for FreePats by roberto@zenvoid.org. | https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/FingerBassYR-SF2-20190930.7z |
| `FreePats_PickedBassYR.sf3` | 34 Electric bass (pick) | Picked Bass YR, version 2019-09-30. Samples by Andrea Biasior from a Yamaha RBX bass, edited for FreePats by roberto@zenvoid.org. | https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/PickedBassYR-SF2-20190930.7z |

## Changes from the originals

Each file was made from the original SF2 with `scripts/prepare-bank.ts`: the preset moved to the program above, samples
re-encoded as mono Ogg Vorbis (SF3), and the outermost samples stretched to cover every key (`--extend-keys`). The
distortion bank was also mixed to mono (its two channels were identical), cut to the velocity layers alphaTab plays,
and its samples trimmed to 10 seconds with a short fade.
