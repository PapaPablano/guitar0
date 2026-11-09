# Tab Highway — project instructions

## Project context

- Product: practise a Guitar Pro / MusicXML tab as a scrolling highway over a synced tab strip, in the browser (static site on GitHub Pages) and as a Windows desktop app (Tauri) that adds stem separation and YouTube play-along.
- Stack: TypeScript + React 19, Vite, Vitest, alphaTab. Desktop shell in `src-tauri/` (Rust); packaging scripts in `scripts/` and `packaging/` (PowerShell, Python).
- Package manager: npm.
- Architecture boundaries (see README "How it fits together"): `src/model` wraps alphaTab output in our own immutable `Score`/`Timeline`; nothing under `src/render` imports alphaTab; renderers are pure functions of a timeline and a time.
- User files stay on the user's device. The app makes no requests to Songsterr and never downloads YouTube audio — do not add either.
- Pro gating is temporarily off (`isPro` forced true in `src/app/tier.ts`). Leave it until asked to restore it.

## Verified commands (2026-11-09)

- Start locally: `npm run dev`
- Focused test: `npx vitest run tests/<area>/<file>.test.ts`
- Full suite: `npm test` (133 files, ~30 s)
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Desktop packaging: see `docs/desktop-packaging.md`.

## Where things live

| Artifact | Location |
|---|---|
| Ideation (ce-ideate output) | `docs/ideation/` |
| Execution plans (ce-plan output, canonical requirements) | `docs/plans/YYYY-MM-DD-HHMM-<type>-<name>-plan.md` |
| Races (multi-deliverable outcomes) | `docs/races/RACE-NNN-<name>.md`, indexed in `docs/races/README.md` |
| Sprints (only when a plan alone isn't enough) | `docs/sprints/RACE-NNN-SPRINT-NN-<name>.md` |
| Reusable lessons (ce-compound) | `docs/solutions/` |
| Non-code launch work | `docs/launch-checklist.md` |
| Templates and workflow guides | `docs/claude-kit/` (`templates/`, `guides/`) |

## Working agreements

- Before substantial work, check `docs/races/README.md` for the active race/sprint and any linked plan in `docs/plans/`. If none, ask whether the work warrants one; a trivial fix does not.
- Race/sprint are our conventions, not plugin features. Inspect installed skill definitions before relying on command names or modes.
- Plans in `docs/plans/` hold requirements. A sprint links to a plan's requirement IDs instead of copying them. Do not rewrite or move historical plans.
- Inspect existing implementation and tests before proposing changes; tests mirror `src/` under `tests/`.
- Honour explicit scope and non-goals. Stop for product, security, data-loss, licensing or external-publication decisions outside granted authority.
- Distinguish verified facts, assumptions and unknowns. Never label an unrun check as passed.
- Finish substantial work with requirement status, commands run and results, skipped checks, residual risks and next action.
- Record a lesson only if it is reusable and not already recoverable from a test, standard or existing solution.
- Follow `CODING_STANDARDS.md` when writing code and `REVIEW.md` when reviewing.

## Authority

Default: local inspection, editing and local checks. Ask before committing, pushing, opening a PR, merging, deploying (a push to `main` deploys the site), installing tools, contacting a new provider or starting a persistent watcher.

If a skill's workflow needs broader authority (e.g. `lfg`, `ce-commit-push-pr`), stop and say so before invoking it. These are model-interpreted agreements, not enforcement.
