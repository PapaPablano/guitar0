# Coding standards

## Correctness

- Implement the approved acceptance criteria without adding unrequested behaviour.
- Validate untrusted inputs (dropped tab files, recordings, URLs) at the boundary where they enter the app.
- Handle retries, duplicate requests and partial failure explicitly where the changed flow can meet them (stem separation, exports, first-run downloads).
- Do not turn a failed operation into apparent success or silently discard errors.

## Change quality

- Prefer existing patterns and dependencies unless a concrete requirement justifies a change.
- Keep changes focused; separate unrelated cleanup from behaviour changes.
- Add abstraction only for a demonstrated need.
- Remove abandoned implementation paths introduced during the task.

## Verification

- Put tests in the existing `tests/<area>/` folder that mirrors `src/<area>/`; do not start a parallel test home.
- Behaviour-changing work needs a relevant test or an explicitly documented limitation.
- Bug fixes should show the pre-fix failure when feasible; do not claim this without evidence.
- Do not weaken assertions, skip tests or edit fixtures just to get green.
- Performance claims need a named metric, comparable conditions and measurements.

## Project-specific rules

- `src/render` must not import alphaTab; go through `src/model` types. Reason: renderers stay pure and testable without alphaTab.
- Model types (`Score`, `Timeline`) are immutable. Reason: render and audio clocks share them.
- Never add network calls to Songsterr or download YouTube audio. Reason: product and provider-policy commitments (see `docs/launch-checklist.md`).
- New dependencies, including Python packages in the desktop runtime, need a licence compatible with commercial use; run `python -I scripts/check-licences.py <site-packages>` for Python and update `THIRD_PARTY_NOTICES.md`.
