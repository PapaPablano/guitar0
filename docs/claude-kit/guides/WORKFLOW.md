# Operating guide

## Definitions

A race is an outcome, not a large to-do bucket. A sprint is a bounded deliverable, not necessarily a fixed calendar interval. A checkpoint is a decision/evidence gate. These definitions are local conventions; choose calendar timeboxes only if they help you coordinate.

## Size work by usefulness

A good sprint can be explained in one outcome sentence, has explicit dependencies, and can be verified without waiting for the whole race. It may include UI, API, storage, and tests together. Avoid splitting solely into database sprint, API sprint, UI sprint when none delivers an independently meaningful or risk-reducing result.

Recommended personal starting limit: one active race and one implementing sprint at a time. This is a suggested focus constraint, not a universal rule. Parallel work needs separate ownership and isolated worktrees when changes can collide.

## Lifecycle

proposed -> ready -> active -> verifying -> complete

Use blocked with a named missing decision/evidence/dependency. Cancelled means intentionally stopped, not failed verification. Do not use complete to hide an incomplete acceptance criterion.

## CE mapping — verify locally

| Need | Candidate CE skill | Important boundary |
|---|---|---|
| Discover a worthwhile race | ce-ideate / ce-strategy | Do not turn suggestions into approved scope |
| Clarify sprint behavior | ce-brainstorm | Resolve product decisions before implementation |
| Plan substantial execution | ce-plan | Link canonical requirements; avoid duplicate plans |
| Implement approved work | ce-work | Inspect side effects; default shipping can exceed local-only authority |
| Diagnose broken behavior | ce-debug | Diagnosis can be requested without a fix |
| Check plan quality | ce-doc-review | On-demand, not a required ritual |
| Check a diff | ce-code-review | Avoid duplicating a review already performed by work |
| Verify UI | ce-test-browser | Confirm required driver and correct running checkout |
| Capture reusable insight | ce-compound | No worthwhile lesson is a valid result |
| Understand implementation | ce-explain | Trace real code and evidence |
| Resume later | ce-handoff | Revalidate current state before continuing |

Names reflect the upstream guidance discussed in the conversation, not a verified inventory of your installation. This kit does not auto-invoke any skill. If a command is absent or its contract conflicts with your task, stop and select an available compatible workflow.

## What not to automate first

Publication, production writes, persistent PR watchers, and new cross-provider routing should remain explicit until you understand their installed contracts and have reliable verification. Use harness permissions and environment controls for actual enforcement. Project prose alone is not sufficient.

## Prevent documentation debt

- Keep only the next sprint detailed; leave later deliverables high-level.
- Update status when real work changes it, not by writing daily prose.
- Store evidence once and link to it.
- Closeout can be short; a lecture is not required.
- Revisit old lessons when code changes make them suspect, not just because time passed.

## Measure whether it helps

Across your own completed sprints, observe requirement misses, avoidable rework, blocked decisions, checks actually executed, and duplicate documentation. Do not invent baselines. Keep a convention only if it improves clarity, verification, or recovery enough to justify maintenance.
