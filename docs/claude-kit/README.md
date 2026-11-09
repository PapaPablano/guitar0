# Race & Sprint Engineering Starter Kit

A lightweight, human-controlled project system for Claude Code and Compound Engineering.

Race -> Sprint -> Checkpoint

- Race: a meaningful outcome delivered across one or more sprints.
- Sprint: a small, coherent slice with observable acceptance criteria.
- Checkpoint: evidence that a sprint has reached a useful state; not another planning document.

These are custom organizational conventions, not built-in Compound Engineering concepts. They do not change plugin behavior. Check installed skill definitions before using any slash command.

## Start here

1. Read `guides/ADOPTION.md`; choose new-project or existing-project adoption.
2. Adapt `CLAUDE.fragment.md` into your existing instructions, or use it to start a new CLAUDE.md. Do not blindly overwrite an existing file.
3. Copy the race template into your chosen project race folder.
4. Copy a sprint template for the first deliverable only. Do not spec every future sprint in detail.
5. Use the task-start prompt in `guides/PROMPTS.md`.
6. At completion, record verification evidence and update the race's sprint table.
7. Preserve a reusable lesson only when it adds value beyond the code or tests.

Suggested project paths (custom, optional):

```text
CLAUDE.md
CODING_STANDARDS.md
REVIEW.md
docs/
  races/RACE-001-short-name.md
  sprints/RACE-001-SPRINT-01-short-name.md
  plans/                 # Existing CE execution plans, if applicable
  solutions/             # Reusable reasoning, not task recaps
```

If CE uses a configured docs_root, keep its artifacts under that root. Reuse your existing task tracker or folders rather than creating duplicate systems.

## Sources of truth

| Question | Canonical location |
|---|---|
| Why are we doing this? | Race |
| What must this slice do? | Sprint |
| How will it be executed? | CE plan, if one is justified |
| What actually passed? | Sprint evidence table |
| What governs implementation? | Existing project instructions and standards |
| What should future work remember? | Test, standard, or narrowly scoped solution |

Link instead of copying. A sprint is not a second CE implementation plan. If the existing plan already holds requirements and evidence, the sprint can be a short index pointing to it.

## Small-work fast path

An isolated typo, formatting correction, or similarly low-risk change needs no race. Use a short task description plus an appropriate check. Create a sprint when coordination or risk makes it useful; create a race when several deliverables serve one outcome.

## Included resources

- `CLAUDE.fragment.md`: concise instruction starter.
- `CODING_STANDARDS.fragment.md`: baseline review criteria for adaptation.
- `REVIEW.fragment.md`: review behavior and evidence policy.
- `templates/RACE.md`: macro outcome and sprint sequence.
- `templates/SPRINT.md`: bounded work, checkpoints, and verification.
- `templates/HANDOFF.md`: resumption without rediscovery.
- `templates/LESSON.md`: optional reusable reasoning.
- `guides/ADOPTION.md`: safe installation and cleanup.
- `guides/WORKFLOW.md`: operating rules and CE mapping.
- `guides/PROMPTS.md`: copy-paste start, review, close, and audit prompts.
- `examples/RACE-001-lead-import.md` and companion sprint: illustrative filled examples, not verified project requirements.

No hooks, plugins, scripts, integrations, or background agents are installed by this kit. It cannot enforce security or guarantee agent compliance.
