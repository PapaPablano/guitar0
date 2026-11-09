# RACE-001: Import leads safely

Illustrative example only. Requirements below are invented for teaching; they are not claims about Eric's systems.

Status: proposed
Owner: project owner

## Outcome

A sales operator can import a CSV of leads, understand rejected rows, and retry a failed upload without accidentally creating duplicate records.

## Success evidence

- A representative approved fixture imports the expected records.
- Repeating the same import does not create duplicates under the agreed identity rule.
- Invalid rows are visible and actionable.
- An unauthorized user cannot import records.

Baseline: not measured. Do not claim time savings yet.

## Non-goals

CRM synchronization, outbound messaging, automatic enrichment, and production migration.

## Sprint sequence

| Sprint | Deliverable | Dependency | Status |
|---|---|---|---|
| SPRINT-01 | Authorized user previews valid and invalid CSV rows without saving | existing authentication | proposed |
| SPRINT-02 | Confirmed import saves valid rows using an approved identity rule | identity decision and SPRINT-01 | proposed |
| SPRINT-03 | Retry and partial-failure behavior verified end-to-end | SPRINT-02 | proposed |

## Open decisions

- What identifies a duplicate: normalized email, external ID, or another key?
- Does one invalid row block the import, or can valid rows proceed?
- What file-size and row-count limits are justified by the environment?

Do not make these silent implementation assumptions.

## Exit

End-to-end preview, confirmation, retry, and rejection flows verified. Production rollout remains separate approval.
