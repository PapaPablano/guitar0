# Coding standards — merge deliberately

Review this against existing standards before adoption. Some CE versions use applicable CODING_STANDARDS.md instead of instruction-file fallback criteria; reconcile important existing rules before introducing it.

## Correctness

- Implement the approved acceptance criteria without adding unrequested behavior.
- Validate untrusted inputs at the appropriate boundary and preserve existing authorization guarantees.
- Treat retries, duplicate requests, and partial failure explicitly when the changed flow can encounter them.
- Do not convert a failed operation into apparent success or silently discard errors.

## Change quality

- Prefer existing patterns and dependencies unless a concrete requirement justifies a change.
- Keep changes focused. Separate unrelated cleanup from behavior changes.
- Add abstraction only for a demonstrated need; avoid speculative extension points.
- Remove abandoned implementation paths introduced during the task.

## Verification

- Inspect existing tests before adding a parallel test home.
- Behavior-changing work needs relevant verification or an explicit documented limitation.
- Bug fixes should demonstrate the relevant pre-fix failure when feasible; do not claim this happened without evidence.
- Do not weaken assertions, skip relevant tests, or modify fixtures merely to obtain a green result.
- Claims about performance improvement require a named metric, comparable conditions, and measurements.

## Project-specific rules

Add only concrete, applicable rules with a reason. A principle that must always be enforced belongs in a deterministic check where feasible, not just in prose.
