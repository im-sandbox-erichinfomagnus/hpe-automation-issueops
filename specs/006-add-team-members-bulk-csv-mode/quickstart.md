# Quickstart: Add Team Members Bulk CSV Mode

## Goal

Validate and operate the add-team-members IssueOps workflow after it is enhanced
with an optional bulk CSV intake path while preserving the existing manual
request path, approval gate, reconciliation semantics, and audit outputs.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the repository.
- A target GitHub organization and team available for validation scenarios.
- An organization owner available to exercise the approval gate.
- A PAT with sufficient organization permissions, stored as a repository or organization secret for workflow use.

## Phase 1 Baseline

- The workflow entrypoint remains `.github/workflows/add-team-members.yml` and continues to run on `ubuntu-latest` with Node.js 24 setup through `actions/setup-node@v6`.
- Workflow linting is enforced by `.github/workflows/lint-workflows.yml` using `rhysd/actionlint@v1.7.12`.
- The enhancement extends `.github/ISSUE_TEMPLATE/add-team-members.yml` rather than creating a parallel issue form.
- Existing approval-gate, execution, and audit scripts remain in place under `src/scripts/` and `src/workflow-support/`.

## Proposed Workflow Path

1. Update `.github/ISSUE_TEMPLATE/add-team-members.yml` so it preserves the existing `requested_people` textarea and adds an optional `bulk_csv_requested_people` textarea for pasted CSV.
2. Keep `.github/workflows/add-team-members.yml` as the thin GitHub-required shim and extend its parser/validation environment to pass both manual and CSV intake fields to the validation runner.
3. Add a shared CSV parsing and normalization helper under `src/workflow-support/` and update `parse-team-membership-request.*` to derive `intake_mode`, normalize one deduplicated people list, and emit CSV row findings.
4. Update `validate-team-membership-request.*` so it enforces exactly one populated intake mode, validates the CSV header and rows when `intake_mode=bulk_csv`, and preserves baseline validation behavior for manual requests.
	- Report CSV validation findings with 1-based data-row numbers that exclude the header row.
5. Reuse the existing org-owner approval gate so approval remains required before any membership mutation.
6. Reuse the existing reconciliation and execution path so current team membership is re-read, only missing users are added, and already-satisfied memberships remain no-op.
7. Extend audit artifacts and requester-facing summaries to report the selected intake mode, duplicate rows, invalid rows, and row-level CSV findings.
8. Add parser fixture, contract, and integration coverage for manual non-regression and CSV-specific validation paths.

## Validation Scenarios

### Scenario 1: Manual-path non-regression

1. Submit an add-team-members request using only the existing `requested_people` field.
2. Confirm validation, approval, reconciliation, and final reporting remain equivalent to the baseline behavior from feature `001-add-team-members`.
3. Confirm no CSV-specific input is required.

### Scenario 2: Valid bulk CSV request

1. Submit a request for an existing team using only `bulk_csv_requested_people` with a valid UTF-8 CSV payload containing the `username` header and multiple rows.
2. Confirm validation derives `intake_mode=bulk_csv`, normalizes the rows into one requested-people list, and marks the request approval-ready.
3. Approve as an organization owner.
4. Confirm missing users are added and the result summary records the intake mode, CSV row counts, and mutation counts.

### Scenario 3: Duplicate CSV rows

1. Submit a bulk CSV request containing repeated usernames that differ only by case or leading `@` prefixes.
2. Confirm validation deduplicates the usernames, records duplicate row findings, and preserves only one downstream membership target per user.
3. Confirm the audit artifact exposes the duplicate-row detail and the final execution summary preserves the duplicate-row count after approval.

### Scenario 4: Invalid or ambiguous CSV intake

1. Submit a bulk CSV request that omits the `username` header, contains malformed rows, includes quoted usernames, includes fully blank rows, or populates both the manual and CSV fields.
2. Confirm validation fails before approval or mutation.
3. Confirm quoted usernames normalize the same way as unquoted usernames, fully blank rows are ignored rather than blocking approval readiness, and invalid submissions still fail with requester-facing row-level or intake-mode findings using 1-based data-row numbers that exclude the header row.

### Scenario 5: Idempotent CSV re-run

1. Approve and execute a valid CSV-driven request.
2. Re-run the same approved request after all memberships are already satisfied.
3. Confirm no duplicate writes occur, the result summary reports only no-op outcomes, and the CSV row metadata remains visible after rerun.

## Scenario 6: Mixed add and no-op CSV execution

1. Approve a valid CSV-driven request where at least one requested user is already a team member and at least one user is still absent.
2. Confirm execution adds only the missing users while reporting already-satisfied memberships as no-op outcomes.
3. Confirm the final audit artifact preserves the CSV `source_row_number` values that led to the add and no-op outcomes.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/add-team-members-bulk-csv-workflow.yaml](./contracts/add-team-members-bulk-csv-workflow.yaml) covers manual-path preservation, CSV intake validation, authorization, reconciliation, and observability behavior.
- The design preserves the baseline `001-add-team-members` approval-gated reconciliation path while adding only intake, parsing, validation, and audit extensions for bulk CSV.
- Tests cover manual non-regression, valid CSV intake, duplicate-row handling, invalid-row rejection, quoted usernames, blank-row handling, mixed add or no-op execution, and idempotent CSV reruns.
