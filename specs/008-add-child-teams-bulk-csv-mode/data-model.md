# Data Model: Add Bulk CSV Mode for Add Child Teams

## TeamHierarchyRequest

- **Purpose**: Represents the parsed and normalized request to attach one or
  more existing child teams under one existing parent team in a target GitHub
  organization through either manual or bulk CSV intake.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the central IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `parent_team_name`: Requested parent team display name.
  - `parent_team_slug`: Comparison-safe normalized slug for the parent team.
  - `designated_approver_login`: Single GitHub login designated to approve the
    full request batch.
  - `intake_mode`: `manual | bulk_csv`.
  - `requested_child_teams_input`: Raw manual textarea input.
  - `bulk_csv_input`: Raw CSV textarea input.
  - `bulk_csv_submission`: Optional normalized CSV metadata.
  - `requested_child_links`: List of normalized requested parent-child links.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization`, `parent_team_name`, and `designated_approver_login` are required.
  - Exactly one of `requested_child_teams_input` or `bulk_csv_input` must be populated.
  - `requested_child_links` must contain at least one unique normalized child team.
  - Team creation, member management, repository access, multi-parent, and multi-organization data are not valid request inputs.

## BulkCsvSubmission

- **Purpose**: Captures the schema and row-level normalization results for a
  pasted CSV payload before it is converted into requested child links.
- **Fields**:
  - `encoding`: Expected text encoding, `utf-8`.
  - `header_columns`: Normalized header names parsed from the payload.
  - `required_columns`: Required schema columns, initially `child_team` only.
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
  - `child_team` must appear exactly once in the header.
  - Unsupported columns are rejected because this enhancement remains within the
    existing one-organization, one-parent, and one-designated-approver model.
  - Blank rows are tracked but do not block approval readiness by themselves.

## CsvRowFinding

- **Purpose**: Records validation detail for one CSV data row.
- **Fields**:
  - `row_number`: 1-based data-row number excluding the header row.
  - `original_row`: Original row content as parsed from the CSV payload.
  - `child_team_name`: Normalized child-team name if available.
  - `normalized_slug`: Derived GitHub slug if available.
  - `validation_status`: `valid | duplicate | invalid | blank`.
  - `failure_reason`: Optional failure classification such as
    `missing_child_team`, `invalid_child_team`, `duplicate_slug`,
    `conflicting_slug`, `inconsistent_shape`, or `blank_row`.
- **Validation rules**:
  - Each non-blank row must resolve to exactly one `child_team` field.
  - Row numbers are stable for audit and requester-facing summaries.

## RequestedChildLink

- **Purpose**: Tracks the validation and execution status of each requested
  child-team relationship after manual or CSV normalization.
- **Fields**:
  - `requested_name`: Requested child-team display name before normalization.
  - `child_team_slug`: GitHub-style normalized slug used for duplicate checks.
  - `source_row_number`: Optional CSV row number when the request originated
    from bulk CSV intake.
  - `validation_status`: `valid | duplicate | conflicting | already_linked | rejected`.
  - `desired_action`: `link_child | noop | reject`.
  - `execution_result`: `not_started | linked | noop | failed`.
  - `current_parent_slug`: Current parent slug if one exists at validation or execution time.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `requested_name` must be non-empty and slug-normalizable.
  - `child_team_slug` must be unique within the request batch.
  - Links that require re-parenting or create cycles are rejected before mutation.

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

- **Purpose**: Represents the diff between current team hierarchy state and the
  approved desired state.
- **Fields**:
  - `organization_exists`: Boolean validation result.
  - `parent_team_exists`: Boolean validation result.
  - `intake_mode`: `manual | bulk_csv` carried forward for audit consistency.
  - `child_links_to_apply`: Requested child links absent from the target parent.
  - `child_links_already_present`: Requested child links already present under the target parent.
  - `child_links_rejected`: Requested child links blocked by validation or policy.
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
  - `applied_count`: Number of successful hierarchy links applied.
  - `noop_count`: Number of already-satisfied requested links.
  - `rejected_count`: Number of requested links rejected before execution.
  - `failure_count`: Number of failed requested links.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `applied_count + noop_count + rejected_count + failure_count` should equal
    the number of requested child links represented in the final artifact.