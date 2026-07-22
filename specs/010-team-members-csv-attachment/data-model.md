# Data Model: Add Team Members CSV Attachment Intake

## TeamMembershipRequest

- **Purpose**: Extends the existing add-team-members request model with an explicit attachment-aware intake discriminator and waiting-state lifecycle while preserving the baseline organization, team, requested-people, approval, and execution fields.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `team_slug`: Target team slug after normalization.
  - `intake_mode`: `manual | csv_attachment`.
  - `requested_people_input`: Raw manual textarea content when `intake_mode=manual`.
  - `accepted_attachment_submission`: Accepted CSV attachment metadata when `intake_mode=csv_attachment` and an attachment candidate has been validated.
  - `requested_people`: List of unique normalized GitHub usernames derived from the selected intake mode.
  - `requested_people_detail`: Per-username normalized detail retained for validation and audit outputs.
  - `request_status`: `submitted | waiting_for_attachment | validation_failed | awaiting_approval | approved | denied | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization` and `team_slug` are required.
  - Exactly one supported intake mode must be selected.
  - `requested_people_input` must be populated only when `intake_mode=manual`.
  - `accepted_attachment_submission` is required before `csv_attachment` requests can advance to approval readiness.
  - `requested_people` must contain at least one unique normalized username after parsing and deduplication.

## CsvAttachmentSubmission

- **Purpose**: Captures the provenance and acceptance state of a requester-authored CSV attachment comment candidate for one add-team-members request.
- **Fields**:
  - `comment_id`: GitHub issue comment identifier containing the accepted attachment link.
  - `comment_created_at`: Timestamp of the comment that supplied the attachment candidate.
  - `uploader_login`: GitHub login of the comment author.
  - `attachment_url`: Resolved linked URL for the candidate attachment.
  - `filename`: Inferred filename when derivable from the URL or related metadata.
  - `extension`: Inferred file extension, expected to be `.csv` for an accepted attachment.
  - `content_hash`: Deterministic digest of the downloaded attachment content.
  - `downloaded_at`: Timestamp when the content was fetched for validation.
  - `byte_size`: Downloaded content length or validated size measurement.
  - `acceptance_status`: `waiting | accepted | rejected | superseded | ignored_terminal_state`.
  - `rejection_reason`: Optional classification such as `non_requester`, `ambiguous_attachment_set`, `missing_csv_extension`, `oversized_attachment`, `download_failed`, or `terminal_state_ignored`.
- **Validation rules**:
  - `uploader_login` must equal the request `requester_login` for acceptance.
  - Exactly one qualifying CSV attachment must be associated with the active processing attempt.
  - `attachment_url`, `content_hash`, and `downloaded_at` are required for accepted attachments.

## CsvAttachmentValidationAttempt

- **Purpose**: Represents one attachment-processing cycle, including candidate selection, provenance evaluation, and CSV-content validation outcome.
- **Fields**:
  - `attempt_id`: Stable identifier derived from issue number, comment id, and run context.
  - `request_id`: Parent request identifier.
  - `candidate_comment_id`: The comment evaluated for this attempt.
  - `attempt_status`: `waiting | attachment_rejected | csv_invalid | csv_valid | superseded | ignored_terminal_state`.
  - `selection_rule`: Description of the deterministic selection policy used for this attempt.
  - `evaluated_at`: Timestamp of validation.
  - `errors`: Blocking attachment or CSV-content validation messages.
  - `warnings`: Non-blocking messages such as deduplicated rows.
  - `supersedes_attempt_id`: Earlier attempt replaced by a later requester attachment comment, if applicable.
- **Validation rules**:
  - `attempt_status=csv_valid` requires an accepted `CsvAttachmentSubmission` and at least one valid normalized requested person.
  - `attempt_status=csv_invalid` preserves row-level findings and keeps the request blocked until a later requester comment is processed.

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

- **Purpose**: Reuses the existing normalized add-team-members person record after manual or attachment intake has been normalized.
- **Fields**:
  - `username`: Normalized GitHub login.
  - `source_row_number`: Optional 1-based CSV data-row number excluding the header row when `intake_mode=csv_attachment`.
  - `source_comment_id`: Optional issue comment id that supplied the accepted attachment.
  - `resolution_status`: `resolved | unresolved`.
  - `current_membership_state`: `active | absent | unknown`.
  - `desired_action`: `noop | add_member | reject`.
  - `execution_result`: `not_started | added | noop | failed`.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `username` must be non-empty after normalization.
  - `resolution_status=unresolved` blocks mutation for that user.

## ApprovalDecision

- **Purpose**: Captures the privileged approval gate required before mutation and remains unchanged across manual and csv_attachment intake modes.
- **Fields**:
  - `approval_status`: `not_requested | pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_role`: `org_owner | other`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as issue comment command or workflow dispatch replay.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - `approval_status=not_requested` is valid while `request_status=waiting_for_attachment`.
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
  - `validated` -> `awaiting_approval`
  - `awaiting_approval` -> `approved_for_execution`
  - `approved_for_execution` -> `executed` or `partially_executed` or `failed`

## ExecutionOutcome

- **Purpose**: Durable result of a run, suitable for audit and requester reporting across manual and attachment-driven requests.
- **Fields**:
  - `run_id`: GitHub Actions run identifier.
  - `run_attempt`: Attempt number.
  - `intake_mode`: `manual | csv_attachment`.
  - `terminal_state`: `not_started | waiting_for_attachment | validation_failed | executed | partially_executed | failed`.
  - `mutation_count`: Number of successful membership writes.
  - `noop_count`: Number of already-satisfied requested memberships.
  - `pending_count`: Number of pending invitation memberships.
  - `failure_count`: Number of failed requested memberships.
  - `duplicate_row_count`: Number of CSV rows deduplicated before reconciliation when `intake_mode=csv_attachment`.
  - `invalid_row_count`: Number of invalid CSV rows that blocked approval readiness when `intake_mode=csv_attachment`.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `mutation_count + noop_count + pending_count + failure_count` should equal the number of validated requested people that reached reconciliation.
  - `duplicate_row_count` and `invalid_row_count` are required for csv_attachment audit visibility even though they do not affect the downstream reconciliation count directly.
  - `terminal_state` becomes immutable for reprocessing purposes once it reaches `executed`, `partially_executed`, or `failed` after approved execution.
