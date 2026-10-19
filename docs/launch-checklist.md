# Launch checklist: Tab Highway Pro

Everything that needs a person, a purchase or a manual pass before charging for Tab Highway. Code work is tracked in `docs/plans/2026-10-18-1305-feat-paid-pro-subscription-launch-plan.md`; this file is for the rest. Fill in the owner and date as each item is done.

Status key: `[ ]` open, `[x]` done.

## 1. Decisions only the owner can make

| Item | Why it blocks | Owner | Done |
|---|---|---|---|
| [ ] Payment provider, monthly price and trial length (plan Q1) | U4 (billing backend) and U6 (checkout from the app) cannot be finished without it | | |
| [ ] Written confirmation that the provider accepts a product with YouTube import (KTD3) | Polar's policy prohibits third-party content downloaders, including YouTube. Paddle's and Lemon Squeezy's policies were not readable during planning and are unverified. If no provider accepts it, choose: switch the feature off for the paid build (`VITE_ENABLE_YOUTUBE=false`), or handle tax directly | | |
| [ ] Whether the Python runtime ships inside the installer or as a separate download (plan Q3) | Measured: the runtime is 959 MB on disk and 288 MB compressed, so shipping it inside the installer makes every app update about 300 MB. Recommendation: install the app without it and download the runtime with the first-run setup, like FFmpeg and the models | | |
| [ ] Crash-reporting service (plan Q2) | U10 | | |
| [ ] Signing method for the installer (plan Q4) | U2 | | |
| [ ] Free-export watermark wording and corner | Currently "Made with Tab Highway", bottom right (`src/export/watermark.ts`) | | |
| [ ] Minimum hardware for stem separation, and a time limit for a typical song | R22 needs a published figure; the app has no hardware check yet | | |

## 2. Accounts, certificates and keys

| Item | Notes | Owner | Done |
|---|---|---|---|
| [ ] Business entity and bank account | | | |
| [ ] Payment provider account (after the written policy check above) | Use the provider's sandbox for the billing tests below | | |
| [ ] Authenticode code-signing certificate, or a cloud signing account | Without it Windows SmartScreen warns on install | | |
| [ ] Update-signing key pair generated, and the private key backed up offline | Losing the private key means installed copies can never update again | | |
| [ ] Entitlement-signing key pair for the billing backend | The public half is compiled into the app as `TABHIGHWAY_STATUS_PUBLIC_KEY` | | |
| [ ] Backend project and an address for it | | | |
| [ ] Hosting for update files and the FFmpeg and model mirror | Set `TABHIGHWAY_MIRROR_URL` (https only) when building a release | | |

## 3. Legal and content

| Item | Notes | Owner | Done |
|---|---|---|---|
| [ ] Trademark search for "Tab Highway" and the icon | Do not use "Guitar Hero" or "Clone Hero" anywhere | | |
| [ ] Terms of service | | | |
| [ ] Privacy policy | Must say the backend stores email, subscription state and device ids, and that crash reports and usage events are opt-in | | |
| [ ] EULA | | | |
| [ ] Refund policy | | | |
| [ ] Terms and licence check of the Gemini-generated guitar image (`src/assets/pick-guitar-photo.jpg`, source `Gemini_Generated_Image_kdhehekdhehekdhe.jpg`) | Confirm commercial use is allowed, or replace it with a photo you own | | |
| [ ] Origin of the existing neck photo (`src/assets/guitar-photo.jpg`) recorded in the notices | | | |
| [ ] Licence of the All-In-One `harmonix-all` checkpoint confirmed | StemDeck states the project and runtime are MIT but not the checkpoint separately | | |
| [ ] Legal review of the YouTube feature | Terms of service and copyright risk for downloading from YouTube once you charge | | |
| [ ] Terms, privacy and refund links added to the installer and the app | R20 | | |

## 4. Before the first paid release

| Item | Notes | Owner | Done |
|---|---|---|---|
| [ ] Build with the signing public key set, and without `TABHIGHWAY_DEV_PRO` | A build made with `TABHIGHWAY_DEV_PRO=1` treats every install as Pro. `scripts/package-windows.ps1` prints a warning when it is set. Never release one | | |
| [ ] Build for the web without `VITE_DEV_PRO` | The web build must stay Free-only | | |
| [ ] Packaging run passes: licence gate green, `licenses/` folder present | `scripts/package-windows.ps1` | | |
| [ ] Support email, help page and changelog published | R26 | | |
| [ ] Pricing page, download page and a demo video | | | |

## 5. Clean-machine pass (R21)

Run each on a machine that has never had Tab Highway. Record pass or fail and what you saw.

| Machine | Install | First launch | Open a tab | Stem split (Pro) | Export | Update | Uninstall |
|---|---|---|---|---|---|---|---|
| Windows 11, standard user, antivirus on | | | | | | | |
| Windows 10, standard user, antivirus on | | | | | | | |
| Username with non-ASCII characters | | | | | | | |
| OneDrive-synced profile (Documents and Desktop in OneDrive) | | | | | | | |
| Low-end laptop, no GPU | | | | | | | |

Also check on at least one machine:

- [ ] A long song (8+ minutes) exports, or can be cancelled cleanly, without freezing the page (R24).
- [ ] A new user reaches a playing tab within two minutes of installing (R25), using the sample riff if they have no file.
- [ ] A typical song splits within the time published for the minimum hardware (R22).
- [ ] An interrupted first-run download resumes on the next launch and says why if it fails (R15).
- [ ] A backup made on one machine restores on another (R23).
- [ ] The installer asks whether to keep saved data when uninstalling (R13).

## 6. Billing tests in the provider's sandbox

- [ ] Start a trial from the app; Pro unlocks without reloading the tab.
- [ ] Cancel; Pro continues to the end date and then locks (F3).
- [ ] Failed payment shows a notice and a grace period, then ends.
- [ ] Refund and chargeback end access at the next status check (AE5).
- [ ] A fourth device is refused with the limit message.
- [ ] A device offline for 5 days still has Pro; at 31 days it asks for an online check (AE4).

## 7. Beta

- [ ] At least 20 users complete install and first stem split on their own machines.
- [ ] Failures are logged and triaged; launch blockers are fixed.
- [ ] Funnel measured: installs, first tab played, upgrade prompt shown, trial started, converted, churned.
