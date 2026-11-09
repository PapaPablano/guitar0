# RACE-<NNN>-SPRINT-<NN>: <bounded deliverable>

Race: <link>
Status: proposed | ready | active | blocked | verifying | complete | cancelled
Owner: <person>
Execution plan: <link if warranted; otherwise this artifact is canonical>

## Outcome and boundaries

Deliver: <one coherent outcome>.
Current behavior: <observed behavior with references>.
In scope: <precise boundary>.
Non-goals: <what not to change>.
Dependencies: <prerequisites or none>.

## Acceptance criteria

- AC-01: Given <state>, when <action>, then <observable result>.
- AC-02: Given <relevant failure>, then <required behavior>.

Keep these here OR in the linked canonical CE plan, not duplicated in both. If delegated to that plan, replace this section with a pointer to its requirement IDs.

## Authority for this sprint

- Allowed: <inspection, local edits, checks, etc.>.
- Requires separate approval: <commits, publication, deployment, production writes, new providers, installs, watchers>.
- Sensitive data/environment restrictions: <actual policy>.

Check skill side effects before invocation. These statements are not a security boundary.

## Checkpoints

| Gate | Evidence required | Status |
|---|---|---|
| C0 Ready | Scope, acceptance criteria, dependencies, authority, and verification understood | pending |
| C1 Implemented | Intended change present; linked plan units updated if used | pending |
| C2 Verified | Requirement-to-check evidence recorded, with limitations | pending |
| C3 Reviewed | Relevant findings resolved, accepted, or recorded; no redundant review required | pending |
| C4 Closed | Outcome and residuals recorded; race index updated; lesson considered | pending |

Checkpoints are gates in this document, not separate mini-projects. Read-only review may overlap verification; mutating review must not race a worker.

## Verification evidence

| Requirement | Check/command or manual procedure | Actual result | Evidence reference | Limitation |
|---|---|---|---|---|
| AC-01 | <check> | not run | <log/screenshot/output reference> | <none or constraint> |
| AC-02 | <check> | not run | <reference> | <constraint> |

Result vocabulary: passed, failed, not run, blocked, human confirmation required, not applicable (with reason). Never infer passed from absence of an error report.

For bug fixes: observed pre-fix failure <evidence or why unavailable>.
For performance: baseline, comparison conditions, measurement, and result <references>.

## Scope changes and blockers

| Date | Proposed change or blocker | Impact | Decision/owner |
|---|---|---|---|
| <date> | <item> | <impact> | <decision> |

## Closeout

Completed requirements: <IDs>.
Incomplete requirements: <IDs or none>.
Review findings: <resolved/accepted/deferred with references>.
Residual risk: <specific risk and owner>.
Lesson: <prevention artifact, solution link, or no reusable lesson>.
Next action: <one concrete action or none>.

Completion requires all required criteria verified, or an explicitly approved scope change. A required check that could not run remains blocked/unverified; accepting its risk does not turn it into a pass.
