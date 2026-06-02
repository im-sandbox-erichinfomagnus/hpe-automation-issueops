# Research: Add Bulk CSV Mode for Add Child Teams

## Decision 1: Reuse the existing add-child-teams workflow and issue form as the only intake surface

- **Decision**: Extend `.github/ISSUE_TEMPLATE/add-child-teams.yml` with an
  optional bulk CSV textarea and keep `.github/workflows/add-child-teams.yml`
  as the single workflow entrypoint.
- **Rationale**: `specs/004-add-child-teams/spec.md` is the authoritative
  baseline and explicitly defines the add-child-teams workflow as the current
  intake and approval surface. Preserving one issue form and one workflow shim
  minimizes regression risk and keeps approval, assignment, and audit behavior
  consistent between manual and CSV requests.
- **Alternatives considered**:
  - Create a parallel CSV-only workflow: rejected because it would split the
    audit surface and create avoidable divergence in approval or execution.
  - Replace the manual field entirely: rejected because the enhancement must be
    additive and preserve the existing manual path.

## Decision 2: Use a single-column CSV schema with one required child-team header

- **Decision**: Define the CSV mode as a UTF-8 textarea containing a header row
  with one required column, `child_team`, and reject unsupported columns.
- **Rationale**: The existing add-child-teams feature uses one request-scoped
  organization, one request-scoped parent team, and one request-scoped
  designated hierarchy approver. A single-column CSV keeps those validation and
  approval constraints intact and matches the existing manual child-team model.
- **Alternatives considered**:
  - Allow `organization`, `parent_team`, or `designated_approver` as row-level
    CSV columns: rejected because they would weaken the existing single-batch
    validation and approval model.
  - Allow multiple supported child-team aliases with no canonical header:
    rejected because one required header produces clearer validation and simpler
    row-level diagnostics.

## Decision 3: Enforce exactly one populated intake mode and normalize both into one downstream request model

- **Decision**: Keep the existing `requested_child_teams` textarea, add an
  optional `bulk_csv_requested_child_teams` textarea, and reject any request
  that populates both or neither. Normalize both intake modes into the same
  `requested_child_links` model used by the current workflow.
- **Rationale**: The prior bulk CSV enhancements demonstrated that explicit
  intake-mode tracking plus early mutual-exclusion validation is the lowest-risk
  way to add bulk input without changing downstream reconciliation or approval
  semantics.
- **Alternatives considered**:
  - Merge manual and CSV inputs before validation: rejected because it hides
    ambiguous requests and makes reviewer-facing diagnostics harder.
  - Introduce a separate execution path for CSV requests: rejected because the
    existing link-only reconciliation path should remain authoritative.

## Decision 4: Reuse row-level findings and summary counts from the earlier bulk CSV pattern

- **Decision**: Record CSV row findings with 1-based data-row numbers that
  exclude the header row, use row statuses such as `valid`, `duplicate`,
  `invalid`, and `blank`, and persist aggregate counts for valid, duplicate,
  and invalid rows in audit outputs and summaries.
- **Rationale**: The prior CSV enhancements already established a
  reviewer-friendly pattern for row-level diagnostics and aggregate reporting.
  Reusing it keeps IssueOps CSV enhancements consistent across workflows.
- **Alternatives considered**:
  - Report only aggregate counts: rejected because requesters would not know
    which rows failed or conflicted.
  - Fail on blank rows: rejected because blank rows are better treated as
    ignorable findings than blocking errors.

## Decision 5: Preserve the existing single designated hierarchy approver model without CSV overrides

- **Decision**: Keep `designated_approver` as a request-level field outside the
  CSV payload and require that CSV-driven requests use the same single-approver
  model defined by `specs/004-add-child-teams/spec.md`.
- **Rationale**: Approval authority is the most sensitive part of the existing
  workflow. Keeping it out of the CSV payload prevents row-level approval drift,
  preserves centralized approval semantics, and avoids reopening the settled
  baseline authorization model.
- **Alternatives considered**:
  - Allow each CSV row to specify a different approver: rejected because it
    would require a new multi-principal approval design.
  - Let any central operator approve CSV batches: rejected because central
    issue assignment remains queue routing only, not authorization.

## Decision 6: Reuse the existing reconciliation and mutation path after intake normalization

- **Decision**: After CSV parsing, validation, and normalization, feed the
  resulting requested-child-link list into the current add-child-teams
  validation, reconciliation, approval, and execution path so only missing
  child links are applied and already-linked teams remain no-op outcomes.
- **Rationale**: `specs/004-add-child-teams/plan.md` and the current workflow
  support modules already define the safe read-before-link pattern,
  PAT-backed execution, rejection of re-parenting or cycles, and idempotent
  no-op rerun behavior. The bulk CSV enhancement should extend only intake and
  audit detail, not the downstream reconciliation contract.
- **Alternatives considered**:
  - Attach child teams directly row by row during CSV parsing: rejected because
    it would bypass the existing reconciliation plan and increase regression
    risk.
  - Treat duplicate CSV rows as separate link attempts: rejected because the
    downstream hierarchy model is slug-based and must remain conflict-safe.

## Decision 7: Treat manual-path non-regression and hierarchy-state safety as explicit delivery risks

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