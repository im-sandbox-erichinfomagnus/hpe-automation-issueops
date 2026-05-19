# Data Model: Add Team Members Bulk CSV Mode

## TeamMembershipRequest

- **Purpose**: Extends the existing add-team-members request model with an explicit intake-mode discriminator while preserving the baseline organization, team, requested-people, approval, and execution fields.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `team_slug`: Target team slug after normalization.
  - `intake_mode`: `manual | bulk_csv`.
  - `requested_people_input`: Raw manual textarea content when `intake_mode=manual`.
  - `bulk_csv_input`: Raw bulk CSV textarea content when `intake_mode=bulk_csv`.
  - `requested_people`: List of unique normalized GitHub usernames derived from the selected intake mode.
  - `requested_people_detail`: Per-username normalized detail retained for validation and audit outputs.
  - `request_status`: `submitted | validation_failed | awaiting_approval | approved | denied | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization` and `team_slug` are required.
  - Exactly one of `requested_people_input` or `bulk_csv_input` must be populated.
  - `requested_people` must contain at least one unique normalized username after parsing and deduplication.
  - `intake_mode` is derived from the populated input source and must not be ambiguous.

## BulkCsvSubmission

- **Purpose**: Captures the raw and normalized metadata for a pasted CSV batch submitted through the add-team-members issue form.
- **Fields**:
  - `encoding`: Expected to be `utf-8` text.
  - `header_columns`: Ordered header values parsed from the first CSV row.
  - `required_columns`: `['username']`.
  - `unsupported_columns`: Any parsed header values not supported for this enhancement.
  - `row_count`: Number of non-header rows observed.
  - `valid_row_count`: Number of rows that produce valid normalized usernames.
  - `invalid_row_count`: Number of rows rejected during CSV validation.
  - `duplicate_row_count`: Number of rows deduplicated after normalization.
  - `schema_status`: `valid | invalid`.
- **Validation rules**:
  - The header row must be present.
  - The `username` column must be present exactly once.
  - Unsupported columns are rejected because the enhancement remains single-team-per-request.

## CsvRowFinding

- **Purpose**: Represents validation evidence for an individual CSV row before downstream approval or reconciliation.
- **Fields**:
  - `row_number`: 1-based CSV data-row number that excludes the header row and is reported consistently in validation findings, summaries, and artifacts.
  - `original_row`: Original row text or parsed values from the submitted CSV.
  - `username`: Normalized GitHub login if derivable.
  - `validation_status`: `valid | duplicate | invalid | blank`.
  - `failure_reason`: `missing_username | invalid_username | malformed_row | unsupported_columns | duplicate_username | blank_row | inconsistent_shape` or another explicit classification.
- **Validation rules**:
  - Every non-header row must produce one row finding.
  - `validation_status=invalid` rows block approval readiness.
  - `validation_status=duplicate` rows do not create duplicate downstream membership changes but remain visible in validation outputs.

## RequestedPerson

- **Purpose**: Reuses the existing normalized add-team-members person record after manual or CSV intake has been normalized.
- **Fields**:
  - `username`: Normalized GitHub login.
  - `source_row_number`: Optional 1-based CSV data-row number excluding the header row when `intake_mode=bulk_csv`.
  - `resolution_status`: `resolved | unresolved`.
  - `current_membership_state`: `active | absent | unknown`.
  - `desired_action`: `noop | add_member | reject`.
  - `execution_result`: `not_started | added | noop | failed`.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `username` must be non-empty after normalization.
  - `resolution_status=unresolved` blocks mutation for that user.

## ApprovalDecision

- **Purpose**: Captures the privileged approval gate required before mutation and remains unchanged across manual and bulk CSV intake modes.
- **Fields**:
  - `approval_status`: `pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_role`: `org_owner | other`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as comment command, review event, or workflow dispatch input.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - Only `org_owner` can move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## ReconciliationPlan

- **Purpose**: Represents the diff between current GitHub team state and the approved desired state after the selected intake mode has been normalized into one people list.
- **Fields**:
  - `team_exists`: Boolean validation result.
  - `team_sync_blocked`: Boolean indicating IdP-managed synchronization.
  - `current_members`: Current active or pending members discovered.
  - `people_to_add`: Requested people absent from current team membership.
  - `people_already_present`: Requested people already active or pending.
  - `people_rejected`: Requested people blocked by validation or policy.
  - `dry_run`: Boolean indicating whether this plan is simulation-only.
  - `rate_limit_snapshot`: Last relevant rate-limit header values captured.
- **State transitions**:
  - `draft` -> `validated`
  - `validated` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## ExecutionOutcome

- **Purpose**: Durable result of a run, suitable for audit and requester reporting across manual and bulk CSV requests.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `intake_mode`: `manual | bulk_csv`.
  - `mutation_count`: Number of successful membership writes.
  - `noop_count`: Number of already-satisfied requested memberships.
  - `pending_count`: Number of pending invitation memberships.
  - `failure_count`: Number of failed requested memberships.
  - `duplicate_row_count`: Number of CSV rows deduplicated before reconciliation when `intake_mode=bulk_csv`.
  - `invalid_row_count`: Number of invalid CSV rows that blocked approval readiness when `intake_mode=bulk_csv`.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `mutation_count + noop_count + pending_count + failure_count` should equal the number of validated requested people that reached reconciliation.
  - `duplicate_row_count` and `invalid_row_count` are required for bulk CSV audit visibility even though they do not affect the downstream reconciliation count directly.
