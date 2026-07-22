# Quickstart: Add Bulk CSV Mode for Team Repository Access

## Goal

Validate and operate the add-team-repo-access IssueOps workflow after it is
enhanced with an optional bulk CSV intake path while preserving the existing
manual request path, designated-approver approval gate, reconciliation
semantics, and audit outputs.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the central administration repository.
- A target GitHub organization available for validation scenarios.
- A PAT with sufficient organization permissions, stored as a repository or
  organization secret named `ISSUEOPS_GITHUB_TOKEN`.
- An existing target team and one or more existing target repositories in the
  same organization.
- A designated repository-access approver who is currently authorized to
  approve the requested repository grants for the full request batch.

## Baseline

- The workflow entrypoint remains `.github/workflows/add-team-repo-access.yml`
  and continues to run on `ubuntu-latest` with Node.js 24 setup through
  `actions/setup-node@v6`.
- The enhancement extends `.github/ISSUE_TEMPLATE/add-team-repo-access.yml`
  rather than creating a parallel issue form or workflow.
- Existing approval-gate, execution, and audit scripts remain in place under
  `src/scripts/` and `src/workflow-support/`.
- The workflow remains limited to repository-access grants only. Team creation,
  team membership changes, hierarchy changes, permission removal, permission
  downgrades, and broader repository administration remain out of scope.

## Operational Notes

- Exactly one intake field must be populated on every request. Validation fails
  when both `requested_repositories` and `bulk_csv_requested_repositories` are
  populated, and it also fails when neither field yields at least one valid
  repository.
- Bulk CSV input accepts properly quoted `repository` values and normalizes
  them the same way as equivalent unquoted repository names.
- Fully blank CSV rows remain visible in row findings but do not block
  approval-readiness on their own.
- Duplicate or conflicting CSV repository rows are rejected rather than silently
  deduplicated because the baseline repository-access workflow already rejects
  ambiguous repository batches.
- The final audit artifact reuses shared execution arrays named
   `created_teams`, `noop_teams`, and `failed_teams`; in this workflow they map
   to granted, already-satisfied, and failed repository-access grants.
- Approved reruns remain idempotent. Once all requested repositories already
  satisfy the requested permission state, the workflow reports only no-op
  outcomes and preserves CSV row provenance in the final artifact.
- Invalid dual-input requests fail closed and keep the reported intake mode
   unset rather than misclassifying the request as manual or bulk CSV.
- CSV intake does not alter the existing rejection rules for archived
  repositories, weaker-permission conflicts, or stronger-permission no-op cases.

## Proposed Workflow Path

1. Update `.github/ISSUE_TEMPLATE/add-team-repo-access.yml` so it preserves the
   existing `requested_repositories` textarea and adds an optional
   `bulk_csv_requested_repositories` textarea for pasted CSV.
2. Keep `.github/workflows/add-team-repo-access.yml` as the thin GitHub-required
   shim and extend its parser or validation environment to pass both manual and
   CSV intake fields to the validation runner.
3. Add a shared CSV parsing and normalization helper under
   `src/workflow-support/` and update `parse-team-repo-access-request.*` to
   derive `intake_mode`, normalize one validated repository-grant list, and
   emit CSV row findings.
4. Update `validate-team-repo-access-request.*` so it enforces exactly one
   populated intake mode, validates the CSV header and rows when
   `intake_mode=bulk_csv`, and preserves baseline validation behavior for manual
   requests.
   - Report CSV validation findings with 1-based data-row numbers that exclude
     the header row.
    - Reject archived repositories before approval readiness even when they are
       supplied through CSV intake.
5. Reuse the existing designated-approver approval gate so approval remains
   required before any repository-permission mutation.
6. Reuse the existing reconciliation and execution path so current repository
   state is re-read, only missing eligible grants are applied, already-satisfied
   repositories remain no-op, stronger existing permissions remain satisfied,
   and weaker-permission conflicts remain rejected.
7. Extend audit artifacts and requester-facing summaries to report the selected
   intake mode, duplicate or conflicting rows, invalid rows, and row-level CSV
   findings.
8. Add parser fixture, contract, and integration coverage for manual
   non-regression and CSV-specific validation paths.

## Validation Scenarios

### Scenario 1: Manual-path non-regression

1. Submit an add-team-repo-access request using only the existing
   `requested_repositories` field.
2. Confirm validation, approval, reconciliation, and final reporting remain
   equivalent to the baseline behavior from feature `005-add-team-repo-access`.
3. Confirm no CSV-specific input is required.

### Scenario 2: Valid bulk CSV request

1. Submit a request for an existing target organization, target team,
   designated repository-access approver, and supported permission level using
   only `bulk_csv_requested_repositories` with a valid UTF-8 CSV payload
   containing the `repository` header and multiple rows.
2. Confirm validation derives `intake_mode=bulk_csv`, normalizes the rows into
   one requested-repository-grant list, and marks the request approval-ready.
3. Approve as the designated repository-access approver.
4. Confirm missing eligible grants are applied and the result summary records
   the intake mode, CSV row counts, and mutation counts.

### Scenario 3: Duplicate or conflicting CSV rows

1. Submit a bulk CSV request containing repeated repository values or different
   repository strings that normalize to the same repository identifier.
2. Confirm validation rejects duplicate rows and conflicting normalized
   repository identifiers according to the same normalization rules used by the
   manual path.
3. Confirm the audit artifact exposes the duplicate or conflicting row detail
   and the final execution summary preserves the relevant counts.

### Scenario 4: Invalid or ambiguous CSV intake

1. Submit a bulk CSV request that omits the `repository` header, contains
   malformed rows, includes fully blank rows, includes unsupported columns, or
   populates both the manual and CSV fields.
2. Confirm validation fails before approval or mutation.
3. Confirm blank rows are ignored rather than blocking approval readiness, and
   invalid submissions still fail with requester-facing row-level or intake-mode
   findings using 1-based data-row numbers that exclude the header row.

### Scenario 5: Ambiguous intake with neither field populated

1. Submit an add-team-repo-access request with a valid organization, target
   team, designated approver, and permission level but leave both
   `requested_repositories` and `bulk_csv_requested_repositories` empty.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary and audit artifact report the exactly-one-intake-mode
   validation error along with the missing requested-repository error, while
   leaving the reported intake mode unset.

### Scenario 6: Idempotent CSV re-run

1. Approve and execute a valid CSV-driven request.
2. Re-run the same approved request after all requested repository access is
   already satisfied.
3. Confirm no duplicate grants occur, the result summary reports only no-op
   outcomes, and the CSV row metadata remains visible after rerun.

### Scenario 7: Mixed apply and no-op CSV execution

1. Approve a valid CSV-driven request where at least one requested repository
   still needs access and at least one repository already satisfies the
   requested permission exactly or with stronger existing access.
2. Confirm execution grants access only to the missing eligible repositories
   while reporting already-satisfied repositories as no-op outcomes.
3. Confirm the final audit artifact preserves the CSV `source_row_number`
   values that led to the applied and no-op outcomes.

### Scenario 8: CSV weaker-permission conflict remains rejected on approved execution

1. Approve a valid CSV-driven request where one repository currently has a
   weaker existing permission than the requested level.
2. Confirm the execution path re-reads current repository state and reports
   that repository as rejected instead of mutating it in place.
3. Confirm the final artifact preserves the rejected repository's CSV
   `source_row_number` for follow-up.

### Scenario 9: Out-of-scope repository-access request fields

1. Submit an add-team-repo-access request that includes otherwise valid access
   input plus out-of-scope team-creation, membership, hierarchy, permission
   removal, or row-level override data.
2. Confirm the request still routes through the add-team-repo-access validator.
3. Confirm the validation output clearly reports that those inputs are out of
   scope and that the workflow only grants missing repository access for one
   existing team and one shared permission level.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/add-team-repo-access-bulk-csv-workflow.yaml](./contracts/add-team-repo-access-bulk-csv-workflow.yaml)
  covers manual-path preservation, CSV intake validation, authorization,
  reconciliation, and observability behavior.
- The design preserves the baseline `005-add-team-repo-access` approval-gated
  reconciliation path while adding only intake, parsing, validation, and audit
  extensions for bulk CSV.
- Tests cover manual non-regression, valid CSV intake, duplicate or conflicting
  row handling, invalid-row rejection, mixed apply-or-no-op execution, stronger
  permission no-op handling, weaker-permission conflict rejection, and
   idempotent CSV reruns.
