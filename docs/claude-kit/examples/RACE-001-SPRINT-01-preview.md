# RACE-001-SPRINT-01: Preview a lead CSV

Illustrative example only; not an approved implementation request.

Race: RACE-001-lead-import.md
Status: proposed
Execution plan: none yet

## Deliverable

An authorized operator can preview row validation without saving any leads.

Non-goals: persistence, CRM calls, enrichment, outbound messages.

## Acceptance criteria

- AC-01: An authorized operator uploading the approved valid fixture sees the expected row count and preview values.
- AC-02: A missing required column produces an actionable validation error.
- AC-03: Invalid rows show row numbers and reasons under the approved validation rules.
- AC-04: An unauthorized request is rejected and reveals no uploaded record data.
- AC-05: Previewing creates no lead records or external side effects.

Required columns and validation rules remain product decisions. This sprint is not ready until they are agreed.

## Authority

Local implementation and test data only after approval. No commits, publication, production access, real customer data, or external API calls.

## Checkpoints

- C0 Ready: column and validation decisions approved; test environment identified.
- C1 Implemented: preview flow present within scope.
- C2 Verified: AC-01 through AC-05 checked.
- C3 Reviewed: relevant diff findings assessed.
- C4 Closed: race index and actual evidence updated.

## Verification evidence

| Criterion | Intended check | Actual result |
|---|---|---|
| AC-01 | Fixture-based route/integration test and rendered preview check | not run |
| AC-02 | Missing-column fixture | not run |
| AC-03 | Invalid-row fixture with expected row references | not run |
| AC-04 | Unauthorized request test | not run |
| AC-05 | Record-count and external-call assertions | not run |

No fictional green results: these are planned checks, not completed evidence.
