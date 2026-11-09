# Review policy

Review against the approved requirements (the linked plan in `docs/plans/` or sprint), `CODING_STANDARDS.md`, and the actual diff.

- Prioritise correctness, user-data safety, licensing, public behaviour and consequential maintenance issues.
- Every finding names the affected code, the triggering circumstances, the concrete impact and the evidence. Label uncertainty honestly.
- Do not invent product requirements or reopen settled preferences without evidence of a defect.
- Do not report speculative abstractions, naming preferences or generic "add tests" requests as blockers. For a test gap, name the behaviour and failure condition the missing test would cover.
- Deduplicate findings; agreement between reviewers does not make a minor issue severe.
- Distinguish missing verification from a demonstrated failure.
- Report scope and any checks or review lenses that did not run.
- Review is report-only unless applying fixes is explicitly authorised.
- Do not edit a checkout another worker is actively modifying.
