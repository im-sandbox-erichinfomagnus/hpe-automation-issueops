# Data Model: Add Team Repo Access CSV Attachment Intake

## TeamRepoAccessRequest

- Purpose: Existing add-team-repo-access request entity extended with intake mode, attachment lifecycle, and terminal-state immutability evidence.
- Fields:
  - request_id: Stable per-issue/run identifier.
  - issue_number: GitHub issue number.
  - repository: Host repository identifier.
  - requester_login: Requester identity.
  - organization: Target organization slug.
  - target_team_slug: Existing target team.
  - requested_permission: One batch permission (`read`, `triage`, `write`, `maintain`, `admin`).
  - designated_approver_login: Single designated target-side approver for full batch.
  - intake_mode: `manual` | `csv_attachment`.
  - requested_repositories_input: Manual repository list input.
  - accepted_attachment_submission: Accepted attachment provenance for `csv_attachment`.
  - requested_repository_grants: Normalized requested repository grant list used by approval/reconciliation.
  - request_status: `submitted` | `waiting_for_attachment` | `validation_failed` | `awaiting_approval` | `approved` | `denied` | `executed` | `partially_executed` | `failed_after_approved_execution`.
- Validation rules:
  - Exactly one intake mode must be selected.
  - `csv_attachment` requires accepted attachment provenance before approval readiness.
  - Terminal states are immutable for attachment reprocessing.

## CsvAttachmentSubmission

- Purpose: Provenance for accepted or rejected attachment candidate.
- Fields:
  - comment_id
  - comment_created_at
  - uploader_login
  - attachment_url
  - filename
  - extension
  - content_hash
  - downloaded_at
  - byte_size
  - acceptance_status: `waiting` | `accepted` | `rejected` | `superseded` | `ignored_terminal_state`
  - rejection_reason
- Validation rules:
  - Uploader must equal requester for accepted candidate.
  - Exactly one candidate per active attempt may be accepted.

## CsvAttachmentValidationAttempt

- Purpose: One attachment-processing cycle for candidate selection and CSV-content validation.
- Fields:
  - attempt_id
  - request_id
  - candidate_comment_id
  - attempt_status: `waiting` | `attachment_rejected` | `csv_invalid` | `csv_valid` | `superseded` | `ignored_terminal_state`
  - evaluated_at
  - errors
  - warnings
  - supersedes_attempt_id
- Validation rules:
  - `csv_valid` requires accepted attachment and at least one valid normalized repository row.

## BulkCsvSubmission

- Purpose: Preserved feature-009 CSV normalization result derived from accepted attachment content.
- Fields:
  - encoding: `utf-8`
  - header_columns
  - required_columns: includes `repository`
  - unsupported_columns
  - row_count
  - valid_row_count
  - invalid_row_count
  - duplicate_row_count
  - schema_status: `valid` | `invalid`
  - schema_errors
  - csv_row_findings
  - csv_row_numbering_convention: 1-based data rows excluding header
- Validation rules:
  - Required `repository` header appears exactly once.
  - Unsupported override columns (org/team/permission/approver) are rejected.

## CsvRowFinding

- Purpose: Row-level diagnostics for accepted attachment CSV.
- Fields:
  - row_number
  - original_row
  - repository_name
  - normalized_repository
  - validation_status: `valid` | `duplicate` | `invalid` | `blank`
  - failure_reason
- Validation rules:
  - Every non-header row has exactly one finding.

## RequestedRepositoryGrant

- Purpose: Normalized desired repository-access grant entry reused by baseline reconciliation.
- Fields:
  - repository_name
  - repository_full_name
  - normalized_repository
  - requested_permission
  - source_row_number
  - source_comment_id
  - validation_status: `valid` | `already_satisfied` | `stronger_permission` | `weaker_conflict` | `missing_repository` | `ineligible_repository`
  - desired_action: `grant_access` | `noop` | `reject`
  - execution_result: `not_started` | `granted` | `noop` | `failed`
  - failure_reason
- Validation rules:
  - Desired action and validation status align with baseline permission compatibility rules.

## ApprovalDecision

- Purpose: Approval state for full request batch.
- Fields:
  - approval_status: `not_requested` | `pending` | `approved` | `denied` | `invalidated`
  - approver_login
  - approver_eligibility: `valid` | `invalid` | `unknown`
  - approved_at
  - decision_note
- Validation rules:
  - Central assignment never implies approval.
  - Approval requires designated approver eligibility checks under baseline model.

## ReconciliationPlan

- Purpose: Desired-vs-current diff used for idempotent mutation.
- Fields:
  - organization_exists
  - team_exists
  - intake_mode
  - grants_to_apply
  - grants_already_satisfied
  - grants_rejected
  - dry_run
  - rate_limit_snapshot
- State transitions:
  - `submitted` -> `waiting_for_attachment` or `awaiting_approval`
  - `awaiting_approval` -> `approved`
  - `approved` -> `executed` | `partially_executed` | `failed_after_approved_execution`

## ExecutionOutcome

- Purpose: Durable execution and audit summary output.
- Fields:
  - run_id
  - run_attempt
  - intake_mode
  - terminal_state
  - applied_count
  - noop_count
  - rejected_count
  - failed_count
  - duplicate_row_count
  - invalid_row_count
  - rollback_status
  - remediation_instructions
  - summary
- Validation rules:
  - Terminal states are immutable for later attachment comments.
  - Counts align with reconciliation scope and per-repository outcomes.
