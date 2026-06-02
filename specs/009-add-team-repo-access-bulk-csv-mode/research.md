# Research: Add Bulk CSV Mode for Team Repository Access

## Decision 1: Reuse the existing add-team-repo-access workflow and issue form as the only intake surface

- **Decision**: Extend `.github/ISSUE_TEMPLATE/add-team-repo-access.yml` with an
  optional bulk CSV textarea and keep `.github/workflows/add-team-repo-access.yml`
  as the single workflow entrypoint.
- **Rationale**: `specs/005-add-team-repo-access/spec.md` is the authoritative
  baseline and already defines the current intake, approval, validation, and
  execution surface. Preserving one issue form and one workflow shim minimizes
  regression risk and keeps approval, assignment, and audit behavior consistent
  between manual and CSV requests.
- **Alternatives considered**:
  - Create a parallel CSV-only workflow: rejected because it would split the
    audit surface and create avoidable divergence in approval or execution.
  - Replace the manual field entirely: rejected because the enhancement must be
    additive and preserve the existing manual path.

## Decision 2: Use a single-column CSV schema with one required repository header

- **Decision**: Define the CSV mode as a UTF-8 textarea containing a header row
  with one required column, `repository`, and reject unsupported columns.
- **Rationale**: The existing add-team-repo-access feature uses one
  request-scoped organization, one request-scoped target team, one
  request-scoped permission level, and one request-scoped designated approver.
  A single-column CSV keeps those validation and approval constraints intact and
  matches the existing manual repository-list model.
- **Alternatives considered**:
  - Allow `organization`, `team`, `permission`, or `designated_approver` as
    row-level CSV columns: rejected because they would weaken the existing
    single-batch validation and approval model.
  - Allow multiple repository aliases with no canonical header: rejected
    because one required header produces clearer validation and simpler
    row-level diagnostics.

## Decision 3: Enforce exactly one populated intake mode and normalize both into one downstream request model

- **Decision**: Keep the existing `requested_repositories` textarea, add an
  optional `bulk_csv_requested_repositories` textarea, and reject any request
  that populates both or neither. Normalize both intake modes into the same
  `requested_repository_grants` model used by the current workflow.
- **Rationale**: The prior bulk CSV enhancements demonstrated that explicit
  intake-mode tracking plus early mutual-exclusion validation is the lowest-risk
  way to add bulk input without changing downstream reconciliation or approval
  semantics.
- **Alternatives considered**:
  - Merge manual and CSV inputs before validation: rejected because it hides
    ambiguous requests and makes reviewer-facing diagnostics harder.
  - Introduce a separate execution path for CSV requests: rejected because the
    existing grant-only reconciliation path should remain authoritative.

## Decision 4: Reject duplicate or conflicting CSV repository rows instead of silently deduplicating them

- **Decision**: Treat duplicate repository rows and different repository values
  that normalize to the same repository identifier as validation failures for
  this workflow, while still preserving row-level findings and aggregate counts.
- **Rationale**: The baseline add-team-repo-access spec already rejects
  duplicate or conflicting repository definitions because repository access
  mutation must remain unambiguous. Reusing that rule for CSV input avoids
  silent coercion that could mask requester mistakes.
- **Alternatives considered**:
  - Silently deduplicate repeated rows before reconciliation: rejected because
    it changes baseline safety semantics and can hide batch authoring errors.
  - Treat each duplicate row as a separate grant attempt: rejected because the
    downstream repository-grant model is normalization-based and must remain
    conflict-safe.

## Decision 5: Reuse row-level findings and summary counts from the earlier bulk CSV pattern

- **Decision**: Record CSV row findings with 1-based data-row numbers that
  exclude the header row, use row statuses such as `valid`, `duplicate`,
  `invalid`, and `blank`, and persist aggregate counts for valid, duplicate,
  and invalid rows in audit outputs and summaries.
- **Rationale**: The earlier CSV enhancements already established a
  reviewer-friendly pattern for row-level diagnostics and aggregate reporting.
  Reusing it keeps IssueOps CSV enhancements consistent across workflows.
- **Alternatives considered**:
  - Report only aggregate counts: rejected because requesters would not know
    which rows failed or conflicted.
  - Fail on blank rows: rejected because blank rows are better treated as
    ignorable findings than blocking errors.

## Decision 6: Preserve the existing single designated repository-access approver model without CSV overrides

- **Decision**: Keep `designated_approver` as a request-level field outside the
  CSV payload and require that CSV-driven requests use the same single-approver
  model defined by `specs/005-add-team-repo-access/spec.md`.
- **Rationale**: Approval authority is the most sensitive part of the existing
  workflow. Keeping it out of the CSV payload prevents row-level approval drift,
  preserves centralized approval semantics, and avoids reopening the settled
  baseline authorization model.
- **Alternatives considered**:
  - Allow each CSV row to specify a different approver: rejected because it
    would require a new multi-principal approval design.
  - Let any central operator approve CSV batches: rejected because central
    issue assignment remains queue routing only, not authorization.

## Decision 7: Reuse the existing reconciliation and mutation path after intake normalization

- **Decision**: After CSV parsing, validation, and normalization, feed the
  resulting requested-repository-grant list into the current add-team-repo-access
  validation, reconciliation, approval, and execution path so only missing
  eligible repository access is granted, exact-match or stronger existing access
  remains no-op, and weaker-permission conflicts remain rejected.
- **Rationale**: The current workflow support modules already define the safe
  read-before-grant pattern, PAT-backed execution, stronger-permission no-op
  handling, weaker-permission conflict rejection, and idempotent rerun
  behavior. The bulk CSV enhancement should extend only intake and audit detail,
  not the downstream reconciliation contract.
- **Alternatives considered**:
  - Grant repository access directly row by row during CSV parsing: rejected
    because it would bypass the existing reconciliation plan and increase
    regression risk.
  - Treat CSV input as a separate repository-access workflow: rejected because
    the baseline approval and mutation path should remain authoritative.

## Decision 8: Treat manual-path non-regression and repository-state safety as explicit delivery risks

- **Decision**: Treat manual-path non-regression, approval-model preservation,
  row-level diagnostic clarity, and high-volume rate-limit pressure as explicit
  risks that must be covered by tests and operator quickstart scenarios.
- **Rationale**: The highest-cost failures in this repository are regressions in
  established behavior and user-visible operational confusion. Making these
  risks explicit early improves task planning and test design.
- **Alternatives considered**:
  - Assume baseline tests are sufficient: rejected because CSV-mode additions
    affect intake, summary, and audit surfaces that manual-path tests may not
    fully protect.
