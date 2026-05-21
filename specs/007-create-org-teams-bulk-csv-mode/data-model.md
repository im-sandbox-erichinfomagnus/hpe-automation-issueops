# Data Model: Add Bulk CSV Mode for Create Organization Teams

## TeamCreationRequest

- **Purpose**: Represents the parsed and normalized request to create one or
  more empty teams in a target GitHub organization through either manual or
  bulk CSV intake.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the central IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `intended_owner_login`: Single GitHub login designated to approve the full
    batch and later own the requested teams operationally.
  - `intake_mode`: `manual | bulk_csv`.
  - `requested_team_names_input`: Raw manual textarea input.
  - `bulk_csv_input`: Raw CSV textarea input.
  - `bulk_csv_submission`: Optional normalized CSV metadata.
  - `requested_teams`: List of normalized requested team definitions.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization` is required.
  - `intended_owner_login` is required and remains shared across the full batch.
  - Exactly one of `requested_team_names_input` or `bulk_csv_input` must be
    populated.
  - `requested_teams` must contain at least one unique normalized team name.
  - Team member lists, parent-team fields, row-level intended owners, and
    multi-organization data are not valid request inputs.

## BulkCsvSubmission

- **Purpose**: Captures the schema and row-level normalization results for a
  pasted CSV payload before it is converted into requested teams.
- **Fields**:
  - `encoding`: Expected text encoding, `utf-8`.
  - `header_columns`: Normalized header names parsed from the payload.
  - `required_columns`: Required schema columns, initially `team_name` only.
  - `unsupported_columns`: Unsupported columns detected in the payload.
  - `row_count`: Number of data rows excluding the header.
  - `valid_row_count`: Number of rows accepted into the normalized request.
  - `invalid_row_count`: Number of rows that block approval readiness.
  - `duplicate_row_count`: Number of rows that duplicate an earlier normalized
    slug or produce a conflicting slug.
  - `schema_status`: `not_provided | valid | invalid`.
  - `schema_errors`: Payload-level schema violations.
  - `raw_input`: Original pasted CSV text.
  - `csv_row_findings`: Per-row findings emitted during parsing.
  - `csv_row_numbering_convention`: Human-readable description of the row
    numbering system.
- **Validation rules**:
  - `team_name` must appear exactly once in the header.
  - Unsupported columns are rejected because this enhancement remains within the
    existing single-organization and single shared intended-owner model.
  - Blank rows are tracked but do not block approval readiness.

## CsvRowFinding

- **Purpose**: Records validation detail for one CSV data row.
- **Fields**:
  - `row_number`: 1-based data-row number excluding the header row.
  - `original_row`: Original row content as parsed from the CSV payload.
  - `team_name`: Normalized team name if available.
  - `normalized_slug`: Derived GitHub slug if available.
  - `validation_status`: `valid | duplicate | invalid | blank`.
  - `failure_reason`: Optional failure classification such as
    `missing_team_name`, `invalid_team_name`, `duplicate_slug`,
    `conflicting_slug`, `inconsistent_shape`, or `blank_row`.
- **Validation rules**:
  - Each non-blank row must resolve to exactly one `team_name` field.
  - Row numbers are stable for audit and requester-facing summaries.

## RequestedTeamDefinition

- **Purpose**: Tracks the validation and execution status of each requested
  team after manual or CSV normalization.
- **Fields**:
  - `requested_name`: Requested team display name before normalization.
  - `normalized_slug`: GitHub-style normalized slug used for duplicate checks.
  - `intended_owner_login`: Intended owner inherited from the request-level
    owner field.
  - `source_row_number`: Optional CSV row number when the request originated
    from bulk CSV intake.
  - `validation_status`: `valid | duplicate | conflicting | existing | rejected`.
  - `desired_action`: `create_team | noop | reject`.
  - `execution_result`: `not_started | created | noop | failed`.
  - `created_team_id`: GitHub team identifier when creation succeeds.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `requested_name` must be non-empty and slug-normalizable.
  - `normalized_slug` must be unique within the request batch.
  - `intended_owner_login` must refer to an active member of the target
    organization.

## CentralAssignmentDecision

- **Purpose**: Records central issue routing that provides queue ownership and
  operational visibility in the hosting repository.
- **Fields**:
  - `assignment_status`: `not_attempted | assigned | already_satisfied | failed`.
  - `assigned_login`: GitHub login of the central-repository owner assigned to
    the issue.
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
  - Only the shared `intended_owner_login` may move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## ReconciliationPlan

- **Purpose**: Represents the diff between current target organization team
  state and the approved desired state.
- **Fields**:
  - `organization_exists`: Boolean validation result.
  - `intake_mode`: `manual | bulk_csv` carried forward for audit consistency.
  - `teams_to_create`: Requested teams absent from the target organization.
  - `teams_already_present`: Requested teams already present in the target
    organization.
  - `teams_rejected`: Requested teams blocked by validation or policy.
  - `dry_run`: Boolean indicating whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## ExecutionOutcome

- **Purpose**: Durable per-run result suitable for audit and requester
  reporting.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `intake_mode`: `manual | bulk_csv`.
  - `duplicate_row_count`: Number of duplicate or conflicting CSV rows tracked
    in the request artifact.
  - `invalid_row_count`: Number of invalid CSV rows that blocked approval.
  - `created_count`: Number of successful team creations.
  - `noop_count`: Number of already-satisfied requested teams.
  - `failure_count`: Number of failed requested teams.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `created_count + noop_count + failure_count` should equal the number of
    requested teams that reached reconciliation.