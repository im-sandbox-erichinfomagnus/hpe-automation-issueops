# Research: Add Bulk CSV Mode for Create Organization Teams

## Decision 1: Reuse the existing create-org-teams workflow and issue form as the only intake surface

- **Decision**: Extend `.github/ISSUE_TEMPLATE/create-org-teams.yml` with an
  optional bulk CSV textarea and keep `.github/workflows/create-org-teams.yml`
  as the single workflow entrypoint.
- **Rationale**: `specs/003-create-org-teams/spec.md` is the authoritative
  baseline and explicitly defines the create-org-teams workflow as the current
  intake and approval surface. Preserving one issue form and one workflow shim
  minimizes regression risk and keeps approval, assignment, and audit behavior
  consistent between manual and CSV requests.
- **Alternatives considered**:
  - Create a parallel CSV-only workflow: rejected because it would split the
    audit surface and create avoidable divergence in approval or execution.
  - Replace the manual field entirely: rejected because the enhancement must be
    additive and preserve the existing manual path.

## Decision 2: Use a single-column CSV schema with the required `team_name` header

- **Decision**: Define the CSV mode as a UTF-8 textarea containing a header row
  with one required column, `team_name`, and reject unsupported columns.
- **Rationale**: The existing create-org-teams feature uses one request-scoped
  organization and one request-scoped intended owner. A single-column CSV keeps
  those approval constraints intact, matches the existing manual data model, and
  mirrors the proven single-column `username` pattern from the add-team-members
  bulk CSV enhancement.
- **Alternatives considered**:
  - Allow `intended_owner` as a row-level CSV column: rejected because it would
    weaken the existing single shared intended-owner approval model.
  - Allow `organization` or `parent_team` CSV columns: rejected because they
    would introduce multi-organization or hierarchy scope that remains out of
    bounds for this feature.

## Decision 3: Enforce exactly one populated intake mode and normalize both into one downstream request model

- **Decision**: Keep the existing `requested_team_names` textarea, add an
  optional `bulk_csv_requested_team_names` textarea, and reject any request that
  populates both or neither. Normalize both intake modes into the same
  `requested_teams` model used by the current workflow.
- **Rationale**: The add-team-members CSV enhancement demonstrated that
  explicit intake-mode tracking plus early mutual-exclusion validation is the
  lowest-risk way to add bulk input without changing downstream reconciliation
  or approval semantics.
- **Alternatives considered**:
  - Merge manual and CSV inputs before validation: rejected because it hides
    ambiguous requests and makes reviewer-facing diagnostics harder.
  - Introduce a separate execution path for CSV requests: rejected because the
    existing create-only-missing reconciliation path should remain authoritative.

## Decision 4: Reuse row-level findings and summary counts from the add-team-members CSV pattern

- **Decision**: Record CSV row findings with 1-based data-row numbers that
  exclude the header row, use row statuses such as `valid`, `duplicate`,
  `invalid`, and `blank`, and persist aggregate counts for valid, duplicate, and
  invalid rows in audit outputs and summaries.
- **Rationale**: The add-team-members bulk CSV feature already established a
  reviewer-friendly pattern for row-level diagnostics and aggregate reporting.
  Reusing it keeps IssueOps CSV enhancements consistent across workflows.
- **Alternatives considered**:
  - Report only aggregate counts: rejected because requesters would not know
    which rows failed or conflicted.
  - Fail on blank rows: rejected because the earlier CSV enhancement proved that
    blank rows are better treated as ignorable findings than blocking errors.

## Decision 5: Preserve the existing single shared intended-owner approval model without CSV overrides

- **Decision**: Keep `intended_owner` as a request-level field outside the CSV
  payload and require that CSV-driven requests use the same single-owner
  approval model defined by `specs/003-create-org-teams/spec.md`.
- **Rationale**: Approval authority is the most sensitive part of the existing
  workflow. Keeping it out of the CSV payload prevents row-level approval drift,
  preserves centralized approval semantics, and avoids reopening the already
  settled baseline authorization model.
- **Alternatives considered**:
  - Allow each CSV row to specify a different owner: rejected because it would
    require a new multi-principal approval design.
  - Let any central operator approve CSV batches: rejected because central issue
    assignment remains queue routing only, not authorization.

## Decision 6: Reuse the existing reconciliation and mutation path after intake normalization

- **Decision**: After CSV parsing, validation, and normalization, feed the
  resulting requested-team list into the current create-org-teams validation,
  reconciliation, approval, and execution path so only missing teams are
  created and already-existing teams remain no-op outcomes.
- **Rationale**: `specs/003-create-org-teams/research.md` already defines the
  safe read-before-create pattern, PAT-backed execution, and idempotent no-op
  rerun behavior. The bulk CSV enhancement should extend only intake and audit
  detail, not the downstream reconciliation contract.
- **Alternatives considered**:
  - Create teams directly row by row from CSV parsing: rejected because it would
    bypass the existing reconciliation plan and increase regression risk.
  - Treat duplicate CSV rows as separate creation attempts: rejected because the
    downstream create-org-teams model is slug-based and must remain conflict-safe.

## Decision 7: Call out regression risks explicitly in plan and tests

- **Decision**: Treat manual-path non-regression, approval-model preservation,
  row-level diagnostic clarity, and high-volume rate-limit pressure as explicit
  risks that must be covered by tests and operator quickstart scenarios.
- **Rationale**: The completed add-team-members CSV enhancement and the recent
  workflow-trigger debugging both showed that the highest-cost failures in this
  repo are regressions in established behavior and user-visible operational
  confusion. Making these risks explicit early improves task planning and test
  design.
- **Alternatives considered**:
  - Assume baseline tests are sufficient: rejected because CSV-mode additions
    affect intake, summary, and audit surfaces that manual-path tests may not
    fully protect.