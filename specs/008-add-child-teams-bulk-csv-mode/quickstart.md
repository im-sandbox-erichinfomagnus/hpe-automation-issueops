# Quickstart: Add Bulk CSV Mode for Add Child Teams

## Goal

Validate and operate the add-child-teams IssueOps workflow after it is enhanced
with an optional bulk CSV intake path while preserving the existing manual
request path, designated-approver approval gate, reconciliation semantics, and
audit outputs.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the central administration repository.
- A target GitHub organization available for validation scenarios.
- A PAT with sufficient organization permissions, stored as a repository or
  organization secret named `ISSUEOPS_GITHUB_TOKEN`.
- An existing target parent team and one or more existing target child teams in
  the same organization.
- A designated hierarchy approver who is currently authorized to approve the
  requested parent-child links for the full request batch.

## Baseline

- The workflow entrypoint remains `.github/workflows/add-child-teams.yml` and
  continues to run on `ubuntu-latest` with Node.js 24 setup through
  `actions/setup-node@v6`.
- The enhancement extends `.github/ISSUE_TEMPLATE/add-child-teams.yml` rather
  than creating a parallel issue form or workflow.
- Existing approval-gate, execution, and audit scripts remain in place under
  `src/scripts/` and `src/workflow-support/`.
- The workflow remains limited to team hierarchy changes only. Team creation,
  member management, repository access changes, and team deletion remain out of scope.

## Operational Notes

- Exactly one intake field must be populated on every request. Validation fails
  when both `requested_child_teams` and `bulk_csv_requested_child_teams` are
  populated, and it also fails when neither field yields at least one valid
  child team.
- Bulk CSV input accepts properly quoted `child_team` values and normalizes
  them the same way as equivalent unquoted child-team names.
- Fully blank CSV rows remain visible in row findings but do not block
  approval-readiness on their own.
- Approved reruns remain idempotent. Once all requested child teams are already
  linked to the requested parent, the workflow reports only no-op outcomes and
  preserves CSV row provenance in the final artifact.
- CSV intake does not alter the existing rejection rules for re-parenting or
  cycle-creating requests.

## Proposed Workflow Path

1. Update `.github/ISSUE_TEMPLATE/add-child-teams.yml` so it preserves the
   existing `requested_child_teams` textarea and adds an optional
   `bulk_csv_requested_child_teams` textarea for pasted CSV.
2. Keep `.github/workflows/add-child-teams.yml` as the thin GitHub-required
   shim and extend its parser or validation environment to pass both manual and
   CSV intake fields to the validation runner.
3. Add a shared CSV parsing and normalization helper under
   `src/workflow-support/` and update `parse-team-hierarchy-request.*` to
   derive `intake_mode`, normalize one validated child-team list, and emit
   CSV row findings.
4. Update `validate-team-hierarchy-request.*` so it enforces exactly one
   populated intake mode, validates the CSV header and rows when
   `intake_mode=bulk_csv`, and preserves baseline validation behavior for manual
   requests.
   - Report CSV validation findings with 1-based data-row numbers that exclude
     the header row.
5. Reuse the existing designated-approver approval gate so approval remains
   required before any hierarchy mutation.
6. Reuse the existing reconciliation and execution path so current hierarchy
   state is re-read, only missing child links are applied, already-satisfied
   links remain no-op, and re-parenting or cycle-creating changes remain rejected.
7. Extend audit artifacts and requester-facing summaries to report the selected
   intake mode, duplicate or conflicting rows, invalid rows, and row-level CSV
   findings.
8. Add parser fixture, contract, and integration coverage for manual
   non-regression and CSV-specific validation paths.

## Validation Scenarios

### Scenario 1: Manual-path non-regression

1. Submit an add-child-teams request using only the existing
   `requested_child_teams` field.
2. Confirm validation, approval, reconciliation, and final reporting remain
   equivalent to the baseline behavior from feature `004-add-child-teams`.
3. Confirm no CSV-specific input is required.

### Scenario 2: Valid bulk CSV request

1. Submit a request for an existing target organization, parent team, and
   designated hierarchy approver using only
   `bulk_csv_requested_child_teams` with a valid UTF-8 CSV payload containing
   the `child_team` header and multiple rows.
2. Confirm validation derives `intake_mode=bulk_csv`, normalizes the rows into
   one requested-child-link list, and marks the request approval-ready.
3. Approve as the designated hierarchy approver.
4. Confirm missing child links are applied and the result summary records the
   intake mode, CSV row counts, and mutation counts.

### Scenario 3: Duplicate or conflicting CSV rows

1. Submit a bulk CSV request containing repeated child-team names or different
   display names that normalize to the same slug.
2. Confirm validation rejects duplicate rows and conflicting normalized slugs
   according to the same normalization rules used by the manual path.
3. Confirm the audit artifact exposes the duplicate or conflicting row detail
   and the final execution summary preserves the relevant counts after approval.

### Scenario 4: Invalid or ambiguous CSV intake

1. Submit a bulk CSV request that omits the `child_team` header, contains
   malformed rows, includes fully blank rows, includes unsupported columns, or
   populates both the manual and CSV fields.
2. Confirm validation fails before approval or mutation.
3. Confirm blank rows are ignored rather than blocking approval readiness, and
   invalid submissions still fail with requester-facing row-level or intake-mode
   findings using 1-based data-row numbers that exclude the header row.

### Scenario 5: Ambiguous intake with neither field populated

1. Submit an add-child-teams request with a valid organization, parent team,
   and designated approver but leave both `requested_child_teams` and
   `bulk_csv_requested_child_teams` empty.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary and audit artifact report the exactly-one-intake-mode
   validation error along with the missing requested-child-team error.

### Scenario 6: Idempotent CSV re-run

1. Approve and execute a valid CSV-driven request.
2. Re-run the same approved request after all requested child teams are already
   linked to the requested parent.
3. Confirm no duplicate hierarchy mutation occurs, the result summary reports
   only no-op outcomes, and the CSV row metadata remains visible after rerun.

### Scenario 7: Mixed apply and no-op CSV execution

1. Approve a valid CSV-driven request where at least one requested child team
   is already linked and at least one link is still missing.
2. Confirm execution links only the missing child teams while reporting
   already-satisfied links as no-op outcomes.
3. Confirm the final audit artifact preserves the CSV `source_row_number`
   values that led to the applied and no-op outcomes.

### Scenario 8: Out-of-scope hierarchy request fields

1. Submit an add-child-teams request that includes otherwise valid hierarchy
   input plus out-of-scope team-creation, membership, or repository-access data.
2. Confirm the request still routes through the add-child-teams validator.
3. Confirm the validation output clearly reports that those inputs are out of
   scope and that the workflow only attaches existing child teams under one existing parent team.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/add-child-teams-bulk-csv-workflow.yaml](./contracts/add-child-teams-bulk-csv-workflow.yaml)
  covers manual-path preservation, CSV intake validation, authorization,
  reconciliation, and observability behavior.
- The design preserves the baseline `004-add-child-teams` approval-gated
  reconciliation path while adding only intake, parsing, validation, and audit
  extensions for bulk CSV.
- Tests cover manual non-regression, valid CSV intake, duplicate or conflicting
  row handling, invalid-row rejection, mixed apply-or-no-op execution, and
  idempotent CSV reruns.