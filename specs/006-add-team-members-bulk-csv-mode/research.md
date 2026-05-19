# Research: Add Bulk CSV Mode for Team Members

## Decision 1: Keep the existing add-team-members workflow and add a second intake field rather than creating a parallel workflow

- **Decision**: Extend the existing `.github/ISSUE_TEMPLATE/add-team-members.yml`, `.github/workflows/add-team-members.yml`, and add-team-members parser and validation modules to accept an optional bulk CSV textarea while preserving the current manual `requested_people` path.
- **Rationale**: The enhancement specification is explicitly additive to `specs/001-add-team-members/spec.md`. Reusing the existing workflow entrypoint, approval gate, reconciliation flow, and audit artifact format avoids downstream behavioral drift between manual and CSV requests.
- **Alternatives considered**:
  - Create a separate bulk CSV workflow and issue form: rejected because it would duplicate approval, reconciliation, and audit logic and increase regression risk for the existing feature.
  - Replace the manual field with a CSV-only intake: rejected because the enhancement must preserve the baseline manual path without changing requester behavior.

## Decision 2: Use mutually exclusive intake fields and derive `intake_mode` during validation

- **Decision**: Keep the existing `requested_people` textarea and add an optional `bulk_csv_requested_people` textarea, then enforce exactly one populated intake mode in downstream validation.
- **Rationale**: GitHub issue forms cannot express cross-field mutual exclusivity, so validation must decide whether the request is `manual` or `bulk_csv`. This preserves the familiar manual field while adding a high-volume path without forcing a separate mode selector that could drift from the actual payload.
- **Alternatives considered**:
  - Add a dropdown mode selector plus both textareas: rejected because the selected mode could disagree with the populated fields and create ambiguous validation states.
  - Keep `requested_people` required at the form layer: rejected because it would make valid CSV-only submissions impossible.

## Decision 3: Require a header row with a minimal single-column CSV schema for v1

- **Decision**: Require pasted UTF-8 CSV with a header row containing exactly one supported required column, `username`, and reject unsupported columns that imply multi-team or multi-organization batching.
- **Rationale**: The baseline add-team-members workflow is scoped to one organization and one team per request. A minimal header-aware schema supports bulk submission while preserving the existing request model and making row-level validation deterministic.
- **Alternatives considered**:
  - Support headerless CSV or plain delimited text: rejected because it is ambiguous and makes future extension harder.
  - Support repeated `organization` and `team_slug` columns: rejected because it conflicts with the current single-team-per-request semantics and would expand scope into multi-target batching.

## Decision 4: Implement a shared repo-local CSV normalization module rather than introducing package management for one parser

- **Decision**: Add a shared workflow-support CSV parsing and normalization module under `src/workflow-support/` that handles UTF-8 text, header validation, quoted fields, blank rows, duplicate detection, and row-level findings for the single-column `username` schema.
- **Rationale**: The repository currently has no `package.json` or existing external CSV dependency surface. A repo-local helper keeps the implementation aligned with the repository's existing support-module pattern and avoids introducing package-management overhead for a narrow enhancement.
- **Alternatives considered**:
  - Add a third-party CSV parsing package: rejected for the initial enhancement because the repository currently relies on repo-local Node modules and the feature needs only a constrained schema.
  - Parse CSV naively by splitting on commas and newlines inside the existing parser: rejected because it would be brittle around quoted fields and harder to reuse across future bulk-input enhancements.

## Decision 5: Normalize CSV rows into the same request and reconciliation model as manual intake

- **Decision**: Convert validated CSV rows into the same normalized `requested_people`, `requested_people_detail`, validation findings, approval state, and reconciliation plan structures already used by the manual add-team-members flow, while adding `intake_mode` and row-level CSV findings for observability.
- **Rationale**: Downstream mutation semantics must not vary by intake mode. Reusing the existing normalized request model keeps validation, approval, reconciliation, idempotency, and audit behavior aligned with the baseline feature.
- **Alternatives considered**:
  - Create a distinct CSV-specific execution model: rejected because it would duplicate existing downstream logic and increase regression risk.
  - Preserve raw CSV rows only and defer normalization until execution: rejected because approval reviewers need normalized and row-level validation findings before authorizing mutation.

## Decision 6: Report row-level validation findings while treating duplicate CSV rows as warnings and invalid rows as blocking errors

- **Decision**: Record a 1-based data-row number that excludes the header row, the original row content, normalized username when available, validation status, and failure reason for each CSV row; duplicate rows are deduplicated with warnings, while malformed rows, invalid usernames, missing required values, and unsupported columns block approval readiness.
- **Rationale**: Requesters and approvers need actionable feedback for bulk submissions without losing the idempotent deduplication behavior already present in the manual path.
- **Alternatives considered**:
  - Reject any request with duplicates as a hard error: rejected because the baseline feature already deduplicates duplicate usernames safely.
  - Ignore invalid rows and continue with the valid subset: rejected because privileged requests should fail closed when the submitted batch is not unambiguously valid.

## Decision 7: Preserve existing approval, rate-limit, and audit mechanics unchanged after intake normalization

- **Decision**: Keep the current org-owner approval gate, PAT-backed workflow credential, bounded retry behavior, and JSON audit artifact flow unchanged after CSV parsing completes.
- **Rationale**: The enhancement changes intake and validation only. Approval, reconciliation, and execution semantics are already defined and implemented for add-team-members and should remain the same for manual and CSV-derived requests.
- **Alternatives considered**:
  - Introduce a separate bulk approval path: rejected because it would create inconsistent authorization behavior.
  - Add CSV-specific reconciliation or rate-limit policies: rejected because the existing reconciliation-first and bounded-retry controls remain valid for a deduplicated user list.
