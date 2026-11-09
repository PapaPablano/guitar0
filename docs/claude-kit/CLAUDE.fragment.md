# Project instructions — adapt before merging

Keep only instructions the repository does not make obvious. Replace placeholders with verified values; omit unknown commands rather than guessing.

## Project context

- Product and intended user: <one sentence>.
- Primary language/runtime: <verified stack>.
- Package manager: <verified tool>.
- Key non-obvious constraint: <constraint and reason, if any>.

## Verified commands

- Start locally: <command>.
- Run a focused test: <command with file placeholder>.
- Run relevant test suite: <command>.
- Typecheck: <command, or not applicable>.
- Lint: <command, or not applicable>.
- Integration-test prerequisites: <non-secret setup reference>.

## Working agreements

- Before substantial work, identify the active race, sprint, and any linked execution plan. If absent, ask whether the work warrants them; do not manufacture paperwork for a trivial fix.
- Treat race/sprint as our project conventions, not plugin features. Inspect installed skill definitions before relying on command names or modes.
- Keep requirements in one canonical artifact and link to it. Do not copy requirements into several plans.
- Inspect existing implementation and tests before proposing changes.
- Honor explicit scope and non-goals. Stop for product, security, data-loss, or external-publication decisions outside granted authority.
- Distinguish verified facts, assumptions, and unknowns. Never label an unrun check as passed.
- Finish substantial work with requirement status, verification commands/results, skipped checks, residual risks, and next action.
- Record a lesson only if it is reusable and not already recoverable from a test, standard, or existing solution.

## Authority

Default request unless the current task explicitly changes it: local inspection, editing, and relevant local checks only. Ask before committing, pushing, opening a PR, merging, deploying, modifying production, installing tools, contacting a new provider, or starting a persistent watcher.

If a selected skill's workflow requires broader authority, stop and explain before invoking it. Do not invoke an autonomous shipping workflow and hope this paragraph prevents its side effects.

These are model-interpreted agreements, not enforcement. Use permissions, sandboxing, CI, restricted credentials, and branch protection for non-negotiable boundaries.
