# Research: Remove Team Repository Access Workflow

## Decision 1: Preserve governance and approval model from add-access baselines

- Decision: Keep the same central-repo IssueOps operating model used by specs 005/009/013: parser-first intake, routing-only assignment, explicit approval gate, and PAT-backed execution.
- Rationale: Removal is at least as sensitive as grants; changing governance would create policy drift and higher risk.
- Alternatives considered:
  - Central assignment as implicit approval: rejected because assignment is operational routing only.
  - Alternate approver models per repository row: rejected because batch-level approval semantics must remain unambiguous.

## Decision 2: Support `manual` and `csv_attachment` intake only

- Decision: Retain manual mode and add/remove support for `csv_attachment` mode with the same waiting/supersession/terminal lifecycle from spec 013.
- Rationale: This preserves high-volume usability while keeping one deterministic workflow path.
- Alternatives considered:
  - Reintroduce textarea `bulk_csv` as a third active mode: rejected for this feature because attachment mode already covers high-volume intake and lifecycle controls.
  - Attachment-only mode with no manual fallback: rejected due to non-regression requirement.

## Decision 3: Keep CSV semantics from spec 009 unchanged after attachment download

- Decision: Preserve required `repository` header, row normalization rules, duplicate/conflict rejection, unsupported-column rejection, and 1-based data-row findings (excluding header).
- Rationale: Intake transport changes (attachment vs textarea) should not alter repository-selection semantics.
- Alternatives considered:
  - Relax duplicate/conflict handling to auto-dedupe: rejected because deterministic failure is safer and auditable.

## Decision 4: Define removal reconciliation as inverse of add-access reconciliation

- Decision: Desired state is no explicit team access on requested repositories. Reconciliation classifies each repository as `remove_access`, `noop_already_absent`, `reject`, or `failed`.
- Rationale: This preserves idempotency and makes reruns safe and deterministic.
- Alternatives considered:
  - Blindly call remove endpoint for all rows: rejected because read-before-mutate and drift-aware outcomes are required.

## Decision 5: Preserve fail-closed behavior and stale-state recomputation

- Decision: Recompute live state between approval and execution and fail closed when preconditions drift into unsafe/invalid states.
- Rationale: Repository/team state can change between approval and execution; safe mutation requires latest state.
- Alternatives considered:
  - Execute against approval-time snapshot only: rejected as unsafe under drift.

## Decision 6: Keep terminal-state immutability for attachment events

- Decision: Once status is `executed`, `partially_executed`, or `failed_after_approved_execution`, later attachment comments are ignored and cannot reopen lifecycle.
- Rationale: Prevents post-execution attachment noise from re-triggering privileged flows.
- Alternatives considered:
  - Allow reopen on newer attachment: rejected by safety and auditability requirements.

## Decision 7: Preserve bounded retry and partial-failure evidence model

- Decision: Retry only retryable throttling/transient failures, preserve partial outcomes, and emit operator remediation guidance for failed subset.
- Rationale: Matches baseline operational guarantees and avoids unsafe infinite retries.
- Alternatives considered:
  - Retry all errors uniformly: rejected because semantic validation/auth failures are non-retryable.
