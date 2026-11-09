# Compound Engineering Research and Usage Playbook

**Prepared for:** Eric Peterson  
**Research checked:** November 2, 2026  
**Focus:** Claude Code, effective prompting, skill selection, verification, safe autonomy, and personal skill development

> **Scope and limitations:** This is a source-backed operating guide, not an audit of Eric's actual installation. No local configuration, project, or session transcript was inspected. Recommendations and original prompt templates are identified as such. Upstream `main` is mutable; check the installed skill definitions before relying on command syntax or side effects.

## Start here

**Recommended approach:** Use Compound Engineering to reduce uncertainty in stages, verify outcomes, and retain valuable reasoning. Do not equate effective use with invoking every available skill.

The documented workflow connects requirements, planning, implementation, and reusable learning; supporting skills address particular needs. The catalog identifies each skill's `SKILL.md` as authoritative for runtime behavior. [cite:99] ([Official catalog](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/README.md))

### Highest-value improvements

These are recommended priorities, not observed deficiencies:

1. Define observable success before authorizing implementation.
2. Separate product decisions from implementation choices.
3. State authority for edits, commits, pushes, PRs, deployments, and external providers separately.
4. Require verification evidence, including missing or skipped checks.
5. Avoid duplicating steps the selected workflow already performs.
6. Capture non-obvious, durable, material reasoning rather than session recaps.
7. Review one important engineering decision personally after substantial work.

### Quick navigation

- [Workflow selection](#workflow-selection)
- [Prompting principles](#prompting-principles)
- [Copy-paste prompts](#copy-paste-prompts)
- [Skill coverage](#skill-coverage)
- [Knowledge placement](#knowledge-placement)
- [Configuration and authority](#configuration-and-authority)
- [Pitfalls and corrections](#pitfalls-and-corrections)
- [Personal improvement plan](#personal-improvement-plan)
- [Worked example](#worked-example)
- [Completion checklist](#completion-checklist)

## Workflow selection

### The operating loop

A useful working model is:

```text
Unclear opportunity -> ideate
Unclear requirements -> brainstorm
Clear requirements -> plan
Implementation-ready plan -> work
Changed behavior -> verify and review
Qualifying durable learning -> compound
```

The catalog presents brainstorm, plan, work, and compound as the central loop, with ideation optional. The repository README additionally names simplification and review explicitly. Treat these as workflow views, not proof that every stage needs a separate manual invocation. [cite:99][cite:150] ([Catalog](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/README.md), [Repository README](https://github.com/everyinc/compound-engineering-plugin))

`ce-work` invokes simplification and code review before its ordinary shipping handoff; its return-to-caller mode omits that standalone tail. Consequently, the correct sequence depends on the selected execution mode. [cite:274][cite:282] ([Review integration](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md), [Return-to-caller contract](https://github.com/EveryInc/compound-engineering-plugin/blob/main/skills/ce-work/references/return-to-caller.md))

### Choose an entry point

| Situation | Starting skill | Intended result |
|---|---|---|
| No clear direction | `/ce-ideate` | Grounded opportunities. [cite:99] |
| Problem known, desired behavior unsettled | `/ce-brainstorm` | Requirements and product decisions. [cite:99] |
| Requirements settled, execution unbounded | `/ce-plan` | Implementation-ready boundaries and verification. [cite:99] |
| Plan ready | `/ce-work` | Implemented and locally verified work, with further behavior depending on mode. [cite:99][cite:282] |
| Existing behavior broken | `/ce-debug` | Root-cause investigation and an optional fix. [cite:281] |
| Need findings on a plan | `/ce-doc-review` | Document findings, not a code review. [cite:99] |
| Need findings on a diff | `/ce-code-review` | Structured review, report-only by default. [cite:274] |
| Important reasoning would otherwise disappear | `/ce-compound` | A qualifying reusable learning. [cite:140] |

**Recommendation:** Scale the process to uncertainty and consequence. A one-line correction rarely warrants a full discovery cycle. Authentication, money, migrations, and public contracts deserve explicit failure-case consideration.

### Human approval gates

The following are recommended operating gates, not mandatory CE configuration:

| Gate | Question to answer |
|---|---|
| Before planning | Is the desired behavior agreed? |
| Before implementation | Is scope small enough and success testable? |
| Before publication | Are checks complete and remaining risks understood? |
| Before external routing | Is the destination authorized for this code and data? |
| Before deployment | Are environment, rollback, and approval explicit? |

## Prompting principles

### Supply missing information

Specific symptoms, constraints, and executable checks are more useful than generic emphasis. Anthropic distinguishes model-interpreted instructions from controls enforced by the harness. [cite:4] ([Claude Code best practices](https://code.claude.com/docs/en/best-practices))

**Original task brief:** Replace the bracketed content before use; omit irrelevant fields.

```text
Outcome: [Who benefits, and what observable result is needed?]
Current behavior: [What happens now? Include a concrete example.]
Acceptance criteria: [What must demonstrably be true?]
Constraints: [Compatibility, privacy, dependencies, or timing.]
Non-goals: [Adjacent work that is explicitly excluded.]
Evidence: [Tests, browser journeys, measurements, or output checks.]
Authority: [Edits, commits, push, PR, deploy, external providers.]
Escalation: [Decisions that require human approval.]
```

### Replace vague wording

These are suggested formulations, not special command keywords.

| Avoid | Prefer |
|---|---|
| “Use all your skills.” | “Select skills that resolve this task's actual uncertainties.” |
| “Make it production-ready.” | “Verify the named authorization, retry, failure, and recovery behaviors.” |
| “Be extremely thorough.” | “Identify high-consequence failure cases and show how they are checked.” |
| “Fix everything.” | “Fix confirmed in-scope defects; list unrelated improvements separately.” |
| “Keep going until perfect.” | “Stop when acceptance criteria pass or a specific blocker prevents progress.” |
| “Remember everything.” | “Preserve only new, verified reasoning that future work would otherwise lose.” |
| “Add more tests.” | “Identify the behavior not covered, then strengthen the narrowest appropriate check.” |

### Distinguish decisions from mechanics

**Recommendation:** Require approval for consequential product choices, privacy changes, new external services, and destructive operations. Let Claude choose ordinary implementation mechanics within the approved scope.

Do not front-load a description of every file. Supply facts that cannot readily be inferred: intended user experience, forbidden tradeoffs, accepted compatibility limits, and the reason a seemingly obvious solution is unsuitable.

### Ask for evidence

Anthropic recommends giving Claude checks it can execute and requesting actual evidence rather than accepting an unsupported completion statement. [cite:4] ([Verification guidance](https://code.claude.com/docs/en/best-practices))

**Recommended evidence record:**

```text
Requirement:
Changed behavior:
Check used:
Exact command or manual steps:
Observed result:
Unverified conditions:
Remaining blocker:
```

Use “unverified” when evidence is missing. A check that could not run is not a passing check.

## Copy-paste prompts

All prompts in this section are original templates. Slash-command names and documented tokens are drawn from the cited documentation; surrounding prose expresses recommended boundaries. These instructions are not security isolation.

### Audit the installation

Use before making configuration changes or installing another workflow plugin.

```text
Audit this repository's Compound Engineering setup. Inspection only.

Do not edit, install, commit, push, open a PR, change configuration,
contact another model provider, or start background watchers.
Do not read secrets or credential files.

Inspect the installed plugin version and actual skill definitions.
Use those definitions, not remembered command behavior.

Inspect applicable project instructions, CE configuration, review policy,
coding standards, declared packs, and available verification tools.

Report:
1. Available skills and missing capabilities.
2. Overlapping plugins, hooks, or contradictory instructions.
3. Reliable test, typecheck, lint, and browser verification commands.
4. Commands that can commit, push, create PRs, or start watchers.
5. External model routes and their disclosure/authorization behavior.
6. Whether prior solutions are discoverable during planning and review.
7. Five evidence-backed improvements, ranked by likely benefit.

Cite local paths for observed findings.
Separate facts, recommendations, and unknowns.
Do not apply improvements yet.
```

### Clarify requirements

The brainstorm skill focuses on the desired product and consequential decisions. [cite:99] ([Skill catalog](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/README.md))

```text
/ce-brainstorm [feature or problem]

Desired outcome: [user and observable benefit].

Inspect relevant existing behavior and project constraints first.
Ask one consequential decision at a time.
Do not ask questions the repository can answer.

Separate requirements, assumptions, non-goals, and unresolved decisions.
Challenge unnecessary scope and identify important failure states.
Prefer the simplest coherent solution.

Do not implement or ship changes.
Finish with requirements and decisions still needing approval.
```

### Prepare an executable plan

```text
/ce-plan [requirements or artifact path]

Preserve agreed requirements and non-goals.
Ground the plan in existing code, relevant prior solutions, and declared rules.
Cite sources that materially affect the approach.

Define observable acceptance criteria, small implementation units,
dependencies, and verification for behavior-changing units.
Consider authorization, data integrity, compatibility, failure, and recovery
where relevant. Do not add unrelated requirements.

Prefer existing patterns and dependencies.
Avoid speculative abstractions or unsupported future-proofing.
Separate genuine blockers from implementation choices.

Stop after planning. No implementation, push, or PR.
```

**Recommended human review:** Look for hidden product decisions, missing failure behavior, new dependencies, and tests that only prove compilation rather than correct outcomes.

### Implement with bounded authority

```text
/ce-work [approved plan path]

Implement the approved plan without expanding product scope.
Inspect existing tests before adding new ones.
Use or strengthen the narrowest appropriate verification.
For bug fixes, observe the relevant failure before the fix when feasible.

Authority for this run:
- Local edits and verification are authorized.
- Local commits are authorized.
- No push, PR creation, merge, deployment, production migration,
  or newly introduced external model provider.

If the installed workflow cannot honor these boundaries, stop and explain
before proceeding.

Finish with completed and incomplete requirements, changed files,
verification commands and actual results, skipped checks and reasons,
blockers, and any remaining background processes.
```

**Boundary to understand:** Return-to-caller mode still commits completed implementation units. It skips standalone final simplification, review, PR, CI, and babysitting; it is not a “no commits” mode. [cite:282] ([Runtime contract](https://github.com/EveryInc/compound-engineering-plugin/blob/main/skills/ce-work/references/return-to-caller.md))

If local commits are also prohibited, change the authority section explicitly and require a compatibility check before work begins. Do not assume a mode token overrides its actual contract.

### Diagnose without patching

Diagnosis-only is supported. Fix-enabled debugging can proceed to commits and a PR handoff, so diagnosis and shipping authority should not be conflated. [cite:281] ([Debugging guide](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-debug.md))

```text
/ce-debug [failure, issue, reproduction, or failing test]

Diagnosis only. Do not edit product code or ship changes.
Expected: [expected behavior].
Observed: [actual behavior].
Reproduction: [steps].
Environment: [known relevant details].

Treat any suspected cause as a hypothesis, not a fact.
Trace the trigger-to-symptom chain with file references.
Separate verified links from assumptions.
For uncertain links, propose a check that distinguishes explanations.

Report the smallest justified fix and its verification strategy.
If reproduction is unavailable, identify the missing evidence.
```

### Review against requirements

`ce-code-review` is report-only by default. `plan:` supplies the requirements artifact; `apply:local` separately grants mutation authority and may permit local commits. [cite:274] ([Review reference](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md))

```text
/ce-code-review plan:[approved plan path]

Report only. Do not apply fixes.
Compare the diff with the approved requirements and applicable standards.
Prioritize correctness and consequential maintenance problems.

For each finding, identify the failure or violated requirement,
its triggering circumstances, and the relevant code.
Distinguish demonstrated defects from unresolved uncertainty.

Do not invent requirements or reopen settled choices merely from preference.
Do not request tests without identifying the behavior they should verify.
List acceptance criteria with missing verification evidence.
```

Leave depth automatic unless there is a reason to force the full pipeline; `depth:full` disables the cheaper review paths. [cite:274] ([Depth selection](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md))

### Test the interface

`current` selects routes from `main...HEAD`; it does not mean every uncommitted edit is automatically included. PR and branch arguments do not switch the checkout. [cite:283] ([Browser scope](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-test-browser.md))

```text
/ce-test-browser current

Confirm the actual diff scope, checked-out branch, and running server first.
Identify whether uncommitted changes are outside the route-selection scope.
Do not claim coverage of changes that were not exercised.

Verify affected journeys against approved acceptance criteria.
Include relevant empty, loading, error, and permission states.
Record console errors and useful screenshots.

Do not make real purchases, send customer messages, or change production data.
Mark human-dependent or unavailable checks unverified, not passed.
Report complete or partial coverage and why.
```

Manual mode expects a listening server. The skill requires a host-native integrated browser or `agent-browser`, not an arbitrary separately installed automation stack. [cite:283] ([Browser prerequisites](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-test-browser.md))

### Capture a useful learning

Current documentation sets three eligibility conditions: non-obvious, durable, and material. Completion or effort alone is insufficient. [cite:140] ([Knowledge-capture criteria](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-compound.md))

```text
/ce-compound [one completed and verified issue]

Evaluate whether any new reasoning qualifies for durable capture.
Do not write a recap merely because the task is complete.

Check whether the lesson already exists in code, tests, types, comments,
standards, a declared pack, or an existing solution.

Prefer the narrowest durable home that communicates the whole lesson.
If a learning document is justified, preserve the verified reasoning,
failed approaches that matter, applicability limits, and source evidence.
Update an overlapping canonical document rather than duplicating it.

If nothing qualifies, say that no capture is needed.
Keep publication and product-code changes outside this request.
```

One learning per run is documented. Non-interactive capture defaults to Full; its `depth:lightweight` option deliberately sacrifices research and validation. [cite:140] ([Capture modes](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-compound.md))

### Preserve a handoff

`ce-handoff` preserves or retrieves session orientation without automatically continuing execution. [cite:99] ([Handoff catalog entry](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/README.md))

```text
/ce-handoff

Preserve the approved goal, plan path, settled decisions, branch and worktree,
completed units, exact verification evidence, unresolved blockers,
publication authority, and next concrete action.

Identify background processes and external routes still in use.
Do not resume implementation or publish anything.
Avoid speculative next steps presented as approved work.
```

### Build personal understanding

`ce-explain` is intended for evidence-backed explanations grounded in the project. [cite:276] ([Explanation guide](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-explain.md))

```text
/ce-explain [one important behavior or engineering decision]

Trace one concrete input through the relevant code.
Explain why this approach fits better than the closest reasonable alternative.
Show the test or observation supporting the conclusion.
Separate demonstrated behavior from assumptions.

Then ask one edge-case prediction question and wait for the answer.
Explain the correction only after the prediction.
```

## Skill coverage

“Full utilization” should mean knowing when a capability is useful, not scheduling every capability into every task. The following catalog groups documented skills by purpose. [cite:99] ([Complete skill catalog](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/README.md))

| Group | Skills | Recommended usage trigger |
|---|---|---|
| Core delivery | `ce-ideate`, `ce-brainstorm`, `ce-plan`, `ce-work`, `ce-compound` | Resolve direction, requirements, execution, and qualifying learning. [cite:99] |
| Strategy and feedback | `ce-strategy`, `ce-product-pulse`, `ce-sweep`, `ce-riffrec-feedback-analysis` | Connect work to product direction and real feedback. [cite:99] |
| Design decisions | `ce-bakeoff`, `ce-pov`, `ce-prototype` | Compare meaningful alternatives or experience an interaction before committing. [cite:99] |
| Investigation and teaching | `ce-debug`, `ce-explain`, `wtf` | Diagnose behavior or understand code and explanations. [cite:99] |
| Review and quality | `ce-code-review`, `ce-doc-review`, `ce-simplify-code`, `ce-optimize` | Find supported defects, reduce complexity, or measure improvement. [cite:99] |
| User-facing checks | `ce-polish`, `ce-dogfood`, `ce-test-browser`, `ce-test-xcode` | Refine UX or verify an actual interface. [cite:99] |
| Git and publication | `ce-commit`, `ce-commit-push-pr`, `ce-worktree`, `ce-babysit-pr`, `ce-resolve-pr-feedback` | Isolate work, commit, publish, or handle incoming review. [cite:99] |
| Autonomous delivery | `lfg` | Execute an appropriately authorized delivery pipeline. [cite:99] |
| Maintenance and orientation | `ce-setup`, `ce-help`, `ce-handoff`, `ce-compound-refresh`, `ce-retune` | Diagnose setup, choose the next step, retain continuity, or maintain knowledge and skills. [cite:99] |
| Writing and collaboration | `ce-noslop`, `ce-promote`, `ce-proof` | Improve prose, draft announcements, or exchange documents. [cite:99] |

### Recommended learning order

1. Master requirements, planning, and bounded implementation.
2. Add diagnosis, evidence-based review, and actual-interface verification.
3. Add selective capture and explanation.
4. Explore bakeoffs, prototypes, optimization, and product feedback when justified.
5. Adopt autonomous pipelines only after boundaries and checks are dependable.

This is an instructional recommendation, not a requirement imposed by the plugin.

## Knowledge placement

### Use the narrowest useful home

Current capture guidance prefers tests, types, or assertions for machine-checkable behavior, comments for local rationale, and solution documents for cross-boundary reasoning. [cite:140] ([Knowledge placement](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-compound.md))

The following is a recommended organization informed by CE review/configuration and Claude Code guidance. [cite:274][cite:4] ([Review customization](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md), [Claude Code guidance](https://code.claude.com/docs/en/best-practices))

| Home | Recommended content |
|---|---|
| `CLAUDE.md` | Essential commands, non-obvious project decisions, and recurrent gotchas. [cite:4] |
| Scoped Claude rules | Guidance relevant only to particular paths. [cite:4] |
| `CODING_STANDARDS.md` | Review criteria describing correct code. [cite:274] |
| `REVIEW.md` | Review behavior, evidence thresholds, and exclusions. [cite:274] |
| `docs/solutions/` | Qualifying reusable reasoning, not task diaries. [cite:140] |
| Declared Compound Packs | Prescriptive domain rules intended to affect multiple stages. [cite:189] |
| A custom skill | A recurring procedure that should load when needed. [cite:4] |
| Tests and CI | Executable checks of behavior or quality. [cite:4] |
| Permissions and sandboxing | Access boundaries that cannot rest solely on prompting. [cite:4] |

**Review trap:** For a changed file governed by `CODING_STANDARDS.md`, that file replaces instruction-file fallback as review criteria; the file is not graded against both sets. Project instructions still matter outside that criteria-selection rule. [cite:274] ([Criteria resolution](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md))

**Policy trap:** CE reads `REVIEW.md` from the base version. A PR cannot immediately weaken its own review by changing that policy in the same diff. [cite:274] ([Review policy](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md))

### Compound Packs

Packs must be declared in CE configuration. Rule files require `title` and `applies_when` frontmatter; invalid files can be skipped. The feature is documented as experimental. [cite:189] ([Pack configuration](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/configuration.md))

**Original illustrative rule:** This is not a built-in CE rule and must be adapted to the actual application.

```yaml
---
title: Repeated lead imports must not create duplicate records
applies_when:
  - adding or changing a lead import
  - changing duplicate detection or import retries
tags: [imports, leads, idempotency]
---

Repeated submission of the same approved import must not create duplicate
lead records. The plan must define record identity and partial-failure behavior.
```

Before adopting it, decide what counts as the same lead. Matching only by a person's name, for example, would be an unapproved product decision in this hypothetical application.

### Maintain stored knowledge

`ce-compound-refresh` reviews existing knowledge against changed code and can update, consolidate, replace, or delete stale material. It is maintenance, not a required stage of every feature. [cite:169] ([Refresh guide](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/ce-compound-refresh.md))

**Recommendation:** Run a scoped refresh after relevant refactors, dependency changes, or contradictory discoveries. Do not create a recurring documentation ritual without a reason.

## Configuration and authority

### Configuration resolution

Ordinary CE settings resolve from `config.local.yaml` before `config.yaml`; current-task instructions can override defaults. `docs_root` is exceptional: it comes only from the shared configuration and must remain within the repository. [cite:189] ([Configuration reference](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/configuration.md))

`packs` is another exception: local and shared lists concatenate, rather than the local file replacing the team's list. [cite:189] ([Pack resolution](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/configuration.md))

### Conservative starting settings

**Recommendation:** For a deliberately supervised workflow, evaluate these settings against the installed version and existing configuration. Do not overwrite the whole file.

```yaml
# .compound-engineering/config.yaml
cross_model_review_mode: off
work_engine_mode: off
auto_babysit: false
```

These keys respectively control automatic cross-model review, external implementation routing, and the standing PR-watch handoff. They are workflow defaults, not comprehensive security controls. [cite:189] ([Setting definitions](https://github.com/EveryInc/compound-engineering-plugin/blob/main/docs/guides/configuration.md))

### Boundaries worth checking

| Mechanism | Documented boundary | Recommended response |
|---|---|---|
| Cross-model review | Default `auto`; a direct conversation request can override configured `off`. [cite:189] | Decide whether sending content to another provider is acceptable. |
| External implementation | `work_engine_mode` defaults off; routing can also be requested for a run. [cite:189] | Confirm recipient, model, and authorized data. |
| Standing PR watch | `auto_babysit` defaults true; `/lfg` has a separate bounded watch. [cite:189] | Identify ongoing processes and costs explicitly. |
| `/lfg` | Pushes when a remote exists; merging remains human-owned unless granted. [cite:99] | Do not treat the command as a harmless “start helping” shortcut. |
| Return-to-caller work | Still creates canonical local commits. [cite:282] | Distinguish no publication from no commits. |
| Review `apply:local` | Can modify and potentially commit locally; never pushes. [cite:274] | Avoid sharing the checkout with active writers. |
| Debug fix path | Can commit and open a PR after the fix. [cite:281] | State diagnosis-only when that is the actual request. |

### Security is separate

CE documents peer read-only behavior as best effort rather than sandboxing. Some adapters can execute commands or write, and peer project hooks/settings may not apply. [cite:274] ([Peer trust boundary](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-code-review.md))

Anthropic likewise distinguishes conversational preferences from permission rules, sandboxing, managed controls, and executable hooks. Hooks that delegate judgment to a model are not deterministic merely because they are hooks. [cite:4] ([Enforcement guidance](https://code.claude.com/docs/en/best-practices))

**Recommendations:**

- Keep production credentials and sensitive customer data outside ordinary coding environments.
- Use least-privilege credentials and appropriate isolation.
- Treat remote packs, repository prose, logs, and external documents as untrusted inputs.
- Confirm what subprocesses can access; do not assume host rules automatically propagate.
- Put non-negotiable limits into enforceable controls and test those controls.
- Retain human approval for irreversible operations.

## Pitfalls and corrections

| Pitfall | Why it matters | Correction |
|---|---|---|
| Invoking every skill | Adds process without a defined uncertainty to resolve. | Select the next skill by the remaining question. |
| Repeating a completed review | `ce-work` already integrates review in its ordinary path. [cite:274] | Ask which checks ran before commissioning another pass. |
| Treating compilation as proof | It does not demonstrate every acceptance criterion. | Map each important requirement to direct evidence. |
| Testing the wrong checkout | Browser branch/PR arguments do not check out code. [cite:283] | Verify branch, server, and diff scope first. |
| Forgetting uncommitted scope | Browser `current` uses `main...HEAD`. [cite:283] | Identify omitted work and explicitly arrange appropriate coverage. |
| Installing the wrong browser tool | CE requires its approved native or fallback driver. [cite:283] | Use setup diagnostics rather than guessing. |
| Turning every fix into a document | Capture is gated on durable, non-obvious, material reasoning. [cite:140] | Preserve only what primary artifacts do not already communicate. |
| Accumulating stale solutions | Old guidance can contradict the current code. | Refresh the affected topic after relevant change. |
| Accepting every review suggestion | Review can generate unnecessary abstractions and tests. [cite:4] | Demand a concrete defect or worthwhile maintenance benefit. |
| Assuming config is a hard prohibition | Current-task instructions can override CE defaults. [cite:189] | Use real controls for hard boundaries. |
| Launching concurrent writers | Local-apply review can mutate a tree another agent is using. [cite:274] | Isolate writers; merge deliberately. |
| Repeating failed patch attempts | Symptoms may improve while the causal explanation remains wrong. | Pause and use diagnosis-only investigation. |
| Maximizing effort everywhere | More reasoning, context, and agents can increase cost without resolving more uncertainty. | Match spending to risk and inspect usage. |
| Outsourcing all understanding | Completed output does not demonstrate personal comprehension. | Explain one decision and predict one edge case yourself. |

The uncited rows are recommended operating judgments, not claims of measured productivity improvement.

## Personal improvement plan

### Establish a baseline

**Recommended practice:** Use the next several real tasks as a small observational sample. Do not invent productivity numbers.

Record:

- Task type and risk.
- Starting command and why it fit.
- Whether requirements changed after implementation began.
- Repeated corrections or reopened decisions.
- Verification evidence and missing checks.
- Review findings accepted, rejected, or deferred, with reasons.
- Background work and external providers used.
- One reusable lesson, or why no capture was justified.
- One concept Eric could explain afterward without assistance.

### Improve one bottleneck

| Observed pattern | Recommended experiment |
|---|---|
| Frequent product rework | Improve brainstorming and non-goals before changing the coding prompt. |
| Repeated “done but broken” outcomes | Strengthen executable acceptance checks. |
| Costly repeated investigations | Improve discoverability and selective capture. |
| Long reviews with little actionable output | Clarify policy and avoid forcing maximum depth. |
| Surprising commits or publication | Tighten authority and enforcement first. |
| Difficulty explaining generated code | Add a short explanation-and-prediction exercise. |

Change one major workflow variable at a time so the result is interpretable. These are proposed experiments, not established causal findings about the user's setup.

### Evaluate a session

Use this original rubric qualitatively; no numerical threshold is validated.

| Dimension | Strong evidence | Warning sign |
|---|---|---|
| Goal clarity | Observable outcome and non-goals | “Make it better” without context |
| Planning | Bounded work and meaningful checks | File list mistaken for a plan |
| Authority | Separate edit/commit/publish permissions | Implicit unlimited autonomy |
| Verification | Actual commands, results, and gaps | Unsupported “all good” |
| Review | Supported findings tied to requirements | Speculative improvements treated as obligations |
| Learning | Narrow, reusable reasoning or justified no-capture | Task diary in solutions |
| Personal skill | Can explain a tradeoff and edge case | Can only repeat the agent's conclusion |

## Worked example

**Hypothetical training scenario:** Build a CSV lead importer. This is not a statement that Eric currently has such an application.

### Weak request

```text
Build a lead importer. Use all Compound Engineering skills and make it
production-ready.
```

This request leaves record identity, duplicate behavior, partial failure, reporting, and authorized side effects undecided.

### Better starting brief

```text
/ce-brainstorm CSV lead import

The desired outcome is importing leads into a test application without
silently duplicating records or losing rejected rows.

Start by inspecting existing lead fields and import behavior.
Ask for decisions the code cannot answer, especially:
- What identifies the same lead?
- How should duplicates within the file be handled?
- Should one invalid row reject the file or only that row?
- What should happen after interruption or retry?
- What result does the user need to see?

Do not choose these product behaviors silently.
Do not implement, contact a CRM, or send customer messages.
```

### Turn decisions into checks

After those choices are approved, ask planning to cover only the agreed behaviors. Possible checks include duplicate handling, invalid rows, retries, permission boundaries, and truthful outcome counts. These are candidate requirements—not defaults the agent should invent.

### Review the finished behavior

A useful review question is: “Can every approved import outcome be demonstrated, including partial failure?” A less useful question is: “Can another abstraction be introduced?”

### Decide what to retain

An obvious field mapping may need no solution document. A verified retry constraint crossing the importer, database, and external service might justify one if it is not recoverable from existing artifacts. Apply the documented capture gate rather than assuming documentation is mandatory. [cite:140] ([Capture criteria](https://github.com/everyinc/compound-engineering-plugin/blob/main/docs/guides/ce-compound.md))

## Completion checklist

This is an original supervised-workflow checklist. Apply only the relevant items.

### Before implementation

- [ ] Desired behavior is observable.
- [ ] Important product decisions are settled.
- [ ] Non-goals and compatibility constraints are explicit.
- [ ] Verification is feasible with available tools.
- [ ] Edit, commit, publication, and external-provider authority are separate.
- [ ] The installed workflow can honor those boundaries.

### Before calling work complete

- [ ] The actual diff matches the approved requirements.
- [ ] Important changed behaviors have evidence or explicit exceptions.
- [ ] Commands and outcomes are recorded.
- [ ] Unavailable checks are marked unverified.
- [ ] UI checks exercised the intended checkout and server.
- [ ] Review findings were evaluated, not accepted blindly.
- [ ] Remaining risks and decisions are visible.
- [ ] Background processes and publication state are known.

### Before closing the session

- [ ] A handoff exists if meaningful work remains.
- [ ] New reasoning was evaluated for durable capture.
- [ ] Existing knowledge was updated instead of duplicated where appropriate.
- [ ] No document was created solely to satisfy a ritual.
- [ ] One important decision can be explained without simply quoting the agent.

## Evidence boundaries

- Findings describe publicly documented behavior checked on November 2, 2026, not a verified local installation.
- Guide-level and top-level workflow descriptions differ in granularity; authoritative runtime definitions and selected modes determine actual execution. [cite:99][cite:150]
- The current capture guide makes learning documentation optional when the final implementation already communicates the lesson. This is more selective than interpreting the loop diagram as a demand for one document per task. [cite:140]
- Prompt templates, approval gates, learning order, examples, and improvement experiments are original recommendations—not official CE guarantees.
- No controlled benchmark, personalized productivity estimate, or measured return on these practices is claimed.
- Inline source links accompany citations so the Markdown remains useful outside this chat.
