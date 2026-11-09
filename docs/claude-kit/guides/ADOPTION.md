# Adoption guide

## New project

1. Establish the repository and verify the local runtime and check commands.
2. Create a concise CLAUDE.md from the fragment. Remove unfilled placeholders.
3. Adapt standards and review policy only if useful; minimal projects may not need both immediately.
4. Choose existing or new locations for race and sprint artifacts.
5. Create one race when the objective spans several deliverables; otherwise use one sprint/task.
6. Define the first sprint's acceptance criteria and authority.
7. Ask Claude to inspect its installed capabilities before selecting commands.
8. Run a small supervised sprint before enabling autonomous publication.

## Existing project — non-destructive migration

1. Start with a clean baseline or identify existing uncommitted work. Do not discard it.
2. Inventory instructions, standards, review policies, active plans, task trackers, hooks, and CE configuration.
3. Ask for a proposed mapping before moving or editing files.
4. Reuse current conventions and IDs when practical. Race/sprint can be tags or sections in the existing tracker.
5. Classify active work: race outcome, current sprint deliverable, implementation details, verification, reusable knowledge.
6. Preserve canonical plans. Add links instead of copying their requirements into new sprint files.
7. Merge selected instruction fragments manually. Reconcile conflicts and remove duplicates.
8. If introducing CODING_STANDARDS.md, inspect installed review resolution and migrate relevant fallback criteria deliberately.
9. Adopt the system for one active initiative; leave historical files where they are unless a real retrieval problem justifies cleanup.
10. Review the resulting diff before approving a commit.

## Safe adaptation prompt

```text
Use this kit as a proposal, not an instruction to overwrite my repository.
Inspection only: map its conventions onto our existing instructions, task
tracker, plans, and verification tools. Do not read secrets.
Identify conflicts, duplicate sources of truth, and unnecessary documents.
Propose the smallest adoption diff and a file-by-file rationale.
Do not edit, move, delete, commit, publish, install, or contact new providers.
Wait for approval before applying the proposed changes.
```

## Cleanup rules

- Do not bulk rename existing artifacts to make the folder tree prettier.
- Do not delete an old instruction until its useful constraints have a clear home.
- Prefer links and a small active-work index to duplicate summaries.
- Keep generated outputs, credentials, logs, and screenshots subject to actual retention and privacy policies.
- Preserve work evidence sufficiently to distinguish real execution from an assertion.
- If the system feels heavy, remove a document or field before inventing another coordinating role.
