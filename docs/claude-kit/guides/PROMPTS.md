# Copy-paste prompts

These are original project prompts, not special command syntax. Replace placeholders. Inspect a skill's local contract before invoking it.

## Start a race — inspection and proposal only

```text
Help define a race for <outcome>. First inspect relevant existing artifacts.
Do not edit yet. Identify the user outcome, current evidence, constraints,
non-goals, consequential open decisions, and smallest coherent sprint sequence.
Keep later sprints high-level. Do not duplicate an existing roadmap or plan.
Recommend the minimum canonical artifacts and wait for approval to create them.
```

## Start an approved sprint

```text
Active race: <path>. Active sprint: <path>. Execution plan: <path or none>.
Read the canonical requirements and inspect current code and tests.
Before editing, summarize the outcome, non-goals, acceptance checks, and authority.
Identify blockers; resolve repository-answerable questions yourself.
Select only relevant available skills and check their side effects first.
Allowed: local edits and local verification.
Not allowed without approval: commits, push, PR, merge, deploy, production writes,
installs, new model providers, or persistent watchers.
If the selected workflow requires broader authority, stop before invoking it.
Proceed only when the sprint is ready and this task authorizes implementation.
```

## Review a sprint without changing it

```text
Review <sprint path> against <canonical plan and actual diff>.
Report only. Map each acceptance criterion to implementation and evidence.
Prioritize concrete correctness gaps; do not invent requirements or style blockers.
Separate defects, missing evidence, and optional improvements.
Do not apply fixes or repeat an already-completed equivalent review without cause.
```

## Close a sprint

```text
Prepare closeout for <sprint>. Inspect the actual diff and available evidence.
Do not mark a check passed unless it ran and its result is available.
List completed/incomplete criteria, exact checks and outcomes, review residuals,
and blockers. If authorized to edit documentation, update the sprint and race
index; otherwise propose those updates only.
Consider whether a test, standard, or focused solution would preserve new learning.
Do not create a recap document merely to fill the lesson field.
Do not commit, publish, or start background work.
```

## Recover after drift

```text
Pause implementation. Compare current work to the approved sprint and plan.
Inspection only: list scope drift, unsupported assumptions, missing verification,
and unintended changes. Do not discard work or attempt another speculative fix.
Propose the smallest recovery path and name the decisions requiring me.
```

## Teach me while closing

```text
Explain one important decision using the code changed in this sprint.
Trace a concrete input to its result and identify the evidence supporting it.
Compare the closest reasonable alternative without inventing requirements.
Ask me to predict one relevant edge case, then wait for my answer.
```

## Maintain the system

```text
Audit our active race/sprint structure. Inspection only.
Identify duplicate sources of truth, stale status, missing outcome checks,
unnecessary paperwork, and authority conflicts. Cite files for observed issues.
Recommend at most five improvements; separate evidence from preferences.
Do not rename or delete files just to standardize appearance.
```
