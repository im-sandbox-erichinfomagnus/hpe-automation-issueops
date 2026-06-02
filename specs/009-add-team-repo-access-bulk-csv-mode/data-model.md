# Data Model: Add Bulk CSV Mode for Team Repository Access

## TeamRepoAccessRequest

- **Purpose**: Represents the parsed and normalized request to grant one
  existing GitHub team access to one or more existing repositories in a target
  GitHub organization through either manual or bulk CSV intake.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the central IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `team_name`: Requested team display name before normalization.
  - `team_slug`: Comparison-safe normalized team slug.
  - `designated_approver_login`: Single GitHub login designated to approve the
    full request batch.
  - `requested_permission_label`: Requested repository role from issue input.
  - `requested_permission_api_value`: Canonical permission value used for API calls.
  - `requested_permission_rank`: Comparison-safe permission rank used during reconciliation.
  - `intake_mode`: `manual | bulk_csv`.
  - `requested_repositories_input`: Raw manual textarea input.
  - `bulk_csv_input`: Raw CSV textarea input.
  - `bulk_csv_submission`: Optional normalized CSV metadata.
  - `requested_repository_grants`: List of normalized requested repository grants.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization`, `team_name`, `designated_approver_login`, and the requested
    permission are required.
  - Exactly one of `requested_repositories_input` or `bulk_csv_input` must be populated.
  - `requested_repository_grants` must contain at least one unique normalized repository.
  - Team creation, membership management, hierarchy changes, repository removal,
    permission downgrades, branch-protection changes, and row-level approver or
    permission overrides are not valid request inputs.

## BulkCsvSubmission

- **Purpose**: Captures the schema and row-level normalization results for a
  pasted CSV payload before it is converted into requested repository grants.
- **Fields**:
  - `encoding`: Expected text encoding, `utf-8`.
  - `header_columns`: Normalized header names parsed from the payload.
  - `required_columns`: Required schema columns, initially `repository` only.
  - `unsupported_columns`: Unsupported columns detected in the payload.
  - `row_count`: Number of data rows excluding the header.
  - `valid_row_count`: Number of rows accepted into the normalized request.
  - `invalid_row_count`: Number of rows that block approval readiness.
  - `duplicate_row_count`: Number of rows that duplicate an earlier normalized
    repository identifier or produce a conflicting normalized identifier.
  - `schema_status`: `not_provided | valid | invalid`.
  - `schema_errors`: Payload-level schema violations.
  - `raw_input`: Original pasted CSV text.
  - `csv_row_findings`: Per-row findings emitted during parsing.
  - `csv_row_numbering_convention`: Human-readable description of the row
    numbering system.
- **Validation rules**:
  - `repository` must appear exactly once in the header.
  - Unsupported columns are rejected because this enhancement remains within the
    existing one-organization, one-team, one-permission, and one-designated-approver model.
  - Blank rows are tracked but do not block approval readiness by themselves.

## CsvRowFinding

- **Purpose**: Records validation detail for one CSV data row.
- **Fields**:
  - `row_number`: 1-based data-row number excluding the header row.
  - `original_row`: Original row content as parsed from the CSV payload.
  - `repository_value`: Normalized repository value if available.
  - `normalized_repository_full_name`: Canonical `owner/repo` identifier if available.
  - `validation_status`: `valid | duplicate | invalid | blank`.
  - `failure_reason`: Optional failure classification such as
    `missing_repository`, `invalid_repository`, `duplicate_repository`,
    `conflicting_repository`, `unsupported_column`, `inconsistent_shape`, or `blank_row`.
- **Validation rules**:
  - Each non-blank row must resolve to exactly one `repository` field.
  - Row numbers are stable for audit and requester-facing summaries.

## RequestedRepositoryGrant

- **Purpose**: Tracks the validation and execution status of each requested
  repository-access grant after manual or CSV normalization.
- **Fields**:
  - `requested_repository_name`: Repository value before normalization.
  - `repository_owner`: Normalized repository owner used for target-org checks.
  - `repository_name`: Normalized repository name.
  - `repository_full_name`: Canonical comparison-safe `owner/repo` identifier.
  - `source_row_number`: Optional CSV row number when the request originated
    from bulk CSV intake.
  - `validation_status`: `valid | exact_match | stronger_existing_access | weaker_existing_access | missing_repository | archived_blocked | conflicting`.
  - `desired_action`: `grant_access | noop | reject`.
  - `execution_result`: `not_started | granted | noop | failed`.
  - `current_permission_api_value`: Current repository permission value if present.
  - `current_permission_rank`: Comparison-safe current permission rank.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `repository_full_name` must be unique within the request batch.
  - Requests that would require modifying weaker existing access or downgrading
    stronger existing access are rejected before mutation.

## CentralAssignmentDecision

- **Purpose**: Records central issue routing that provides queue ownership and
  operational visibility in the hosting repository.
- **Fields**:
  - `assignment_status`: `not_attempted | assigned | already_satisfied | failed`.
  - `assigned_login`: GitHub login of the central-repository owner assigned to the issue.
  - `assignment_note`: Optional reason or failure note.
  - `assigned_at`: Timestamp for the last successful assignment decision.
- **Validation rules**:
  - Assignment does not change approval eligibility.
  - Assignment failure must not be treated as approval failure if request
    validation otherwise succeeds.

## ApprovalDecision

- **Purpose**: Captures the explicit approval gate required before mutation.
- **Fields**:
  - `approval_status`: `pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_membership_state`: `active | pending | absent | unknown`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as issue comment command.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - Only the shared `designated_approver_login` may move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## ReconciliationPlan

- **Purpose**: Represents the diff between current repository-team permission
  state and the approved desired state.
- **Fields**:
  - `organization_exists`: Boolean validation result.
  - `team_exists`: Boolean validation result.
  - `intake_mode`: `manual | bulk_csv` carried forward for audit consistency.
  - `repository_grants_to_apply`: Requested repository grants absent from the desired permission state.
  - `repository_grants_already_satisfied`: Requested repository grants already satisfied by exact-match or stronger access.
  - `repository_grants_rejected`: Requested repository grants blocked by validation or policy.
  - `dry_run`: Boolean indicating whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## ExecutionOutcome

- **Purpose**: Durable per-run result suitable for audit and requester reporting.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `intake_mode`: `manual | bulk_csv`.
  - `duplicate_row_count`: Number of duplicate or conflicting CSV rows tracked in the request artifact.
  - `invalid_row_count`: Number of invalid CSV rows that blocked approval.
  - `granted_count`: Number of successful repository grants applied.
  - `noop_count`: Number of already-satisfied requested grants.
  - `rejected_count`: Number of requested grants rejected before execution.
  - `failure_count`: Number of failed requested grants.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `granted_count + noop_count + rejected_count + failure_count` should equal
    the number of requested repository grants represented in the final artifact.
