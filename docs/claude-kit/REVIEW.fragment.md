# Review policy — adapt and merge

Review against approved requirements, applicable standards, and the actual diff.

- Prioritize correctness, security, data integrity, public contracts, and consequential maintenance issues.
- Every finding must identify the affected code, triggering circumstances, concrete impact, and supporting evidence. Label uncertainty honestly.
- Do not invent product requirements or reopen settled preferences without evidence of a defect.
- Do not report speculative abstractions, naming preferences, or generic requests to add tests as blockers.
- For a test gap, name the behavior and failure condition the missing test would cover.
- Deduplicate findings; several reviewers agreeing does not make a minor issue severe.
- Distinguish missing verification from a demonstrated implementation failure.
- Report scope and any checks or review lenses that did not run.
- Review is report-only unless application of fixes is explicitly authorized.
- Do not edit a checkout another worker is actively modifying.

Before adopting new review rules, inspect how the installed reviewer discovers policy and which revision it reads. Do not assume a policy edited inside a change immediately governs that same review.
