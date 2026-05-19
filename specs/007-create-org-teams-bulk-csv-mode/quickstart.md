# Quickstart: Add Bulk CSV Mode for Create Organization Teams

## Goal

Validate and operate the create-org-teams IssueOps workflow after it is
enhanced with an optional bulk CSV intake path while preserving the existing
manual request path, intended-owner approval gate, reconciliation semantics,
and audit outputs.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the central administration repository.
- A target GitHub organization available for validation scenarios.
- A PAT with sufficient organization permissions, stored as a repository or
  organization secret named `ISSUEOPS_GITHUB_TOKEN`.
- A target organization member designated as the intended owner for the teams in
  a request batch.

## Baseline

- The workflow entrypoint remains `.github/workflows/create-org-teams.yml` and
  continues to run on `ubuntu-latest` with Node.js 24 setup through
  `actions/setup-node@v6`.
- The enhancement extends `.github/ISSUE_TEMPLATE/create-org-teams.yml` rather
  than creating a parallel issue form or workflow.
- Existing approval-gate, execution, and audit scripts remain in place under
  `src/scripts/` and `src/workflow-support/`.
- The workflow remains limited to empty-team creation only. Team membership
  population and parent-team configuration remain out of scope.

## Operational Notes

- Exactly one intake field must be populated on every request. Validation fails
   when both `requested_team_names` and `bulk_csv_requested_team_names` are
   populated, and it also fails when neither field is populated.
- Bulk CSV input accepts properly quoted `team_name` values and normalizes them
   the same way as equivalent unquoted team names.
- Fully blank CSV rows remain visible in row findings but do not block
   approval-readiness on their own.
- Approved reruns remain idempotent. Once all requested teams already exist,
   the workflow reports only no-op outcomes and preserves CSV row provenance in
   the final artifact.
- GitHub automatically makes the authenticated creator a maintainer of each new
   team, so operators should treat that creator-maintainer behavior as an
   execution-time platform constraint rather than a configurable workflow rule.

## Proposed Workflow Path

1. Update `.github/ISSUE_TEMPLATE/create-org-teams.yml` so it preserves the
   existing `requested_team_names` textarea and adds an optional
   `bulk_csv_requested_team_names` textarea for pasted CSV.
2. Keep `.github/workflows/create-org-teams.yml` as the thin GitHub-required
   shim and extend its parser or validation environment to pass both manual and
   CSV intake fields to the validation runner.
3. Add a shared CSV parsing and normalization helper under `src/workflow-support/`
   and update `parse-team-creation-request.*` to derive `intake_mode`,
   normalize one deduplicated team list, and emit CSV row findings.
4. Update `validate-team-creation-request.*` so it enforces exactly one
   populated intake mode, validates the CSV header and rows when
   `intake_mode=bulk_csv`, and preserves baseline validation behavior for manual
   requests.
   - Report CSV validation findings with 1-based data-row numbers that exclude
     the header row.
5. Reuse the existing intended-owner approval gate so approval remains required
   before any team creation mutation.
6. Reuse the existing reconciliation and execution path so current team state is
   re-read, only missing teams are created, and already-satisfied teams remain
   no-op.
7. Extend audit artifacts and requester-facing summaries to report the selected
   intake mode, duplicate or conflicting rows, invalid rows, and row-level CSV
   findings.
8. Add parser fixture, contract, and integration coverage for manual
   non-regression and CSV-specific validation paths.

## Validation Scenarios

### Scenario 1: Manual-path non-regression

1. Submit a create-org-teams request using only the existing
   `requested_team_names` field.
2. Confirm validation, approval, reconciliation, and final reporting remain
   equivalent to the baseline behavior from feature `003-create-org-teams`.
3. Confirm no CSV-specific input is required.

### Scenario 2: Valid bulk CSV request

1. Submit a request for an existing target organization using only
   `bulk_csv_requested_team_names` with a valid UTF-8 CSV payload containing the
   `team_name` header and multiple rows.
2. Confirm validation derives `intake_mode=bulk_csv`, normalizes the rows into
   one requested-team list, and marks the request approval-ready.
3. Approve as the intended owner.
4. Confirm missing teams are created and the result summary records the intake
   mode, CSV row counts, and mutation counts.

### Scenario 3: Duplicate or conflicting CSV rows

1. Submit a bulk CSV request containing repeated team names or different display
   names that normalize to the same slug.
2. Confirm validation deduplicates or rejects the conflicting rows according to
   the same normalization rules used by the manual path.
3. Confirm the audit artifact exposes the duplicate or conflicting row detail
   and the final execution summary preserves the relevant counts after approval.

### Scenario 4: Invalid or ambiguous CSV intake

1. Submit a bulk CSV request that omits the `team_name` header, contains
   malformed rows, includes fully blank rows, includes unsupported columns, or
   populates both the manual and CSV fields.
2. Confirm validation fails before approval or mutation.
3. Confirm blank rows are ignored rather than blocking approval readiness, and
   invalid submissions still fail with requester-facing row-level or intake-mode
   findings using 1-based data-row numbers that exclude the header row.

### Scenario 5: Ambiguous intake with neither field populated

1. Submit a create-org-teams request with a valid organization and intended
   owner but leave both `requested_team_names` and
   `bulk_csv_requested_team_names` empty.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary and audit artifact report the exactly-one-intake-mode
   validation error along with the missing requested-team error.

### Scenario 6: Idempotent CSV re-run

1. Approve and execute a valid CSV-driven request.
2. Re-run the same approved request after all requested teams already exist.
3. Confirm no duplicate team creation occurs, the result summary reports only
   no-op outcomes, and the CSV row metadata remains visible after rerun.

### Scenario 7: Mixed create and no-op CSV execution

1. Approve a valid CSV-driven request where at least one requested team already
   exists and at least one team is still missing.
2. Confirm execution creates only the missing teams while reporting
   already-satisfied teams as no-op outcomes.
3. Confirm the final audit artifact preserves the CSV `source_row_number`
   values that led to the create and no-op outcomes.

### Scenario 8: Out-of-scope create request fields

1. Submit a create-org-teams request that includes otherwise valid team-creation
   input plus out-of-scope membership or parent-team fields.
2. Confirm the request still routes through the create-org-teams validator.
3. Confirm the validation output clearly reports that parent-team input is out
   of scope and that the workflow only creates empty teams.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/create-org-teams-bulk-csv-workflow.yaml](./contracts/create-org-teams-bulk-csv-workflow.yaml)
  covers manual-path preservation, CSV intake validation, authorization,
  reconciliation, and observability behavior.
- The design preserves the baseline `003-create-org-teams` approval-gated
  reconciliation path while adding only intake, parsing, validation, and audit
  extensions for bulk CSV.
- Tests cover manual non-regression, valid CSV intake, duplicate or conflicting
  row handling, invalid-row rejection, mixed create or no-op execution, and
  idempotent CSV reruns.