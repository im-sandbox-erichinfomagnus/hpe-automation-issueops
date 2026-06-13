# Data Model: Remove Team Repository Access Workflow

## TeamRepoAccessRemovalRequest

- Purpose: Parsed and normalized request to remove one existing team from one or more repositories in one target organization.
- Fields:
  - `request_id`
  - `issue_number`
  - `repository`
  - `requester_login`
  - `organization`
  - `target_team_slug`
  - `designated_approver_login`
  - `intake_mode`: `manual | csv_attachment`
  - `requested_repositories_input`
  - `accepted_attachment_submission`
  - `requested_repository_removals`
  - `request_status`: `submitted | waiting_for_attachment | validation_failed | awaiting_approval | approved | executed | partially_executed | failed_after_approved_execution`
  - `dry_run`
- Validation rules:
  - Exactly one intake mode must be selected.
  - At least one normalized repository is required.
  - Exactly one organization, one team, one designated approver per batch.

## CsvAttachmentSubmission

- Purpose: Provenance and acceptance state for csv attachment candidate processing.
- Fields:
  - `comment_id`
  - `comment_created_at`
  - `uploader_login`
  - `attachment_url`
  - `filename`
  - `content_hash`
  - `byte_size`
  - `acceptance_status`: `waiting | accepted | rejected | superseded | ignored_terminal_state`
  - `rejection_reason`
- Validation rules:
  - Accepted candidate must be requester-authored and same-issue comment sourced.
  - Candidate selection is deterministic and fail-closed.

## BulkCsvSubmission

- Purpose: Preserved CSV normalization metadata derived from accepted attachment content.
- Fields:
  - `encoding`
  - `header_columns`
  - `required_columns`
  - `unsupported_columns`
  - `row_count`
  - `valid_row_count`
  - `invalid_row_count`
  - `duplicate_row_count`
  - `schema_status`
  - `schema_errors`
  - `csv_row_findings`
  - `csv_row_numbering_convention`
- Validation rules:
  - `repository` header required.
  - Unsupported override columns rejected.

## CsvRowFinding

- Purpose: Per-row validation diagnostics for attachment CSV.
- Fields:
  - `row_number`
  - `original_row`
  - `repository_value`
  - `normalized_repository_full_name`
  - `validation_status`: `valid | duplicate | invalid | blank`
  - `failure_reason`

## RequestedRepositoryRemoval

- Purpose: Per-repository normalized removal intent and outcome.
- Fields:
  - `repository_name`
  - `repository_full_name`
  - `source_row_number`
  - `source_comment_id`
  - `current_team_permission`
  - `validation_status`: `valid | missing_repository | archived_blocked | conflict | ineligible_repository`
  - `desired_action`: `remove_access | noop_already_absent | reject`
  - `execution_result`: `not_started | removed | noop | failed`
  - `failure_reason`
- Validation rules:
  - Unique normalized repository identifiers per batch.

## ApprovalDecision

- Purpose: Batch-level approval evidence.
- Fields:
  - `approval_status`
  - `approver_login`
  - `approver_eligibility`
  - `approved_at`
  - `decision_note`
- Validation rules:
  - Approver must equal designated approver and be active target org owner.

## ReconciliationPlan

- Purpose: Live-state diff between desired removal state and current permissions.
- Fields:
  - `organization_exists`
  - `team_exists`
  - `removals_to_apply`
  - `already_absent_noops`
  - `rejected_items`
  - `dry_run`
  - `rate_limit_snapshot`
- State transitions:
  - `submitted` -> `waiting_for_attachment | awaiting_approval | validation_failed`
  - `awaiting_approval` -> `approved`
  - `approved` -> `executed | partially_executed | failed_after_approved_execution`

## ExecutionOutcome

- Purpose: Durable per-run execution summary and audit output.
- Fields:
  - `run_id`
  - `run_attempt`
  - `intake_mode`
  - `removed_count`
  - `noop_count`
  - `rejected_count`
  - `failed_count`
  - `rollback_status`
  - `remediation_instructions`
  - `summary`
- Validation rules:
  - Terminal states are immutable for attachment-triggered lifecycle re-entry.
