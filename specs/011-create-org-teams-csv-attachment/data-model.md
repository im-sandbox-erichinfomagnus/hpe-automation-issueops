# Data Model: Create Organization Teams CSV Attachment Intake

## TeamCreationRequest

- **Purpose**: Extends the existing create-org-teams request model with an explicit attachment-aware intake discriminator and waiting-state lifecycle while preserving the baseline organization, intended-owner, requested-team, approval, and execution fields.
- **Fields**:
  - `request_id`: Stable identifier derived from issue number and run context.
  - `issue_number`: GitHub issue number carrying the request.
  - `repository`: Repository hosting the IssueOps workflow.
  - `requester_login`: GitHub login of the requester.
  - `organization`: Target GitHub organization slug.
  - `intended_owner_login`: Single GitHub login designated to approve the full batch and later own the requested teams operationally.
  - `intake_mode`: `manual | csv_attachment`.
  - `requested_team_names_input`: Raw manual textarea content when `intake_mode=manual`.
  - `accepted_attachment_submission`: Accepted CSV attachment metadata when `intake_mode=csv_attachment` and an attachment candidate has been validated.
  - `requested_teams`: List of unique normalized requested team definitions derived from the selected intake mode.
  - `bulk_csv_submission`: Optional normalized CSV metadata preserved for row-level findings and audit outputs when the attachment path is used.
  - `request_status`: `submitted | waiting_for_attachment | validation_failed | awaiting_approval | approved | denied | executed | partially_executed | failed`.
  - `submitted_at`: Timestamp of request intake.
- **Validation rules**:
  - `organization` and `intended_owner_login` are required.
  - Exactly one supported intake mode must be selected.
  - `requested_team_names_input` must be populated only when `intake_mode=manual`.
  - `accepted_attachment_submission` is required before `csv_attachment` requests can advance to approval readiness.
  - `requested_teams` must contain at least one unique normalized team after parsing and deduplication.

## CsvAttachmentSubmission

- **Purpose**: Captures the provenance and acceptance state of a requester-authored CSV attachment comment candidate for one create-org-teams request.
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
  - `attempt_status=csv_valid` requires an accepted `CsvAttachmentSubmission` and at least one valid normalized requested team.
  - `attempt_status=csv_invalid` preserves row-level findings and keeps the request blocked until a later requester comment is processed.

## BulkCsvSubmission

- **Purpose**: Captures the schema and row-level normalization results for the accepted CSV attachment before it is converted into requested teams.
- **Fields**:
  - `encoding`: Expected text encoding, `utf-8`.
  - `header_columns`: Normalized header names parsed from the payload.
  - `required_columns`: Required schema columns, `team_name` only.
  - `unsupported_columns`: Unsupported columns detected in the payload.
  - `row_count`: Number of data rows excluding the header.
  - `valid_row_count`: Number of rows accepted into the normalized request.
  - `invalid_row_count`: Number of rows that block approval readiness.
  - `duplicate_row_count`: Number of rows that duplicate an earlier normalized slug or produce a conflicting slug.
  - `schema_status`: `waiting | valid | invalid`.
  - `schema_errors`: Payload-level schema violations.
  - `csv_row_findings`: Per-row findings emitted during parsing.
  - `csv_row_numbering_convention`: Human-readable description of the row-numbering system.
- **Validation rules**:
  - `team_name` must appear exactly once in the header.
  - Unsupported columns are rejected because this enhancement remains within the existing single-organization and single shared intended-owner model.
  - Blank rows are tracked but do not block approval readiness on their own.

## CsvRowFinding

- **Purpose**: Records validation detail for one CSV data row.
- **Fields**:
  - `row_number`: 1-based data-row number excluding the header row.
  - `original_row`: Original row content as parsed from the CSV attachment.
  - `team_name`: Normalized team name if available.
  - `normalized_slug`: Derived GitHub slug if available.
  - `validation_status`: `valid | duplicate | invalid | blank`.
  - `failure_reason`: Optional failure classification such as `missing_team_name`, `invalid_team_name`, `duplicate_slug`, `conflicting_slug`, `inconsistent_shape`, `unsupported_columns`, or `blank_row`.
- **Validation rules**:
  - Every non-header row must produce one row finding.
  - `validation_status=invalid` rows block approval readiness.
  - `validation_status=duplicate` rows do not create duplicate downstream team creation attempts but remain visible in validation outputs.

## RequestedTeamDefinition

- **Purpose**: Tracks the validation and execution status of each requested team after manual or attachment intake has been normalized.
- **Fields**:
  - `requested_name`: Requested team display name before normalization.
  - `normalized_slug`: GitHub-style normalized slug used for duplicate checks.
  - `intended_owner_login`: Intended owner inherited from the request-level owner field.
  - `source_row_number`: Optional CSV row number when the request originated from attachment intake.
  - `source_comment_id`: Optional issue comment id that supplied the accepted attachment.
  - `validation_status`: `valid | duplicate | conflicting | existing | rejected`.
  - `desired_action`: `create_team | noop | reject`.
  - `execution_result`: `not_started | created | noop | failed`.
  - `created_team_id`: GitHub team identifier when creation succeeds.
  - `failure_reason`: Optional error classification.
- **Validation rules**:
  - `requested_name` must be non-empty and slug-normalizable.
  - `normalized_slug` must be unique within the request batch after duplicate and conflict handling.
  - `intended_owner_login` must refer to an active member of the target organization.

## ApprovalDecision

- **Purpose**: Captures the privileged approval gate required before mutation and remains unchanged across manual and csv_attachment intake modes.
- **Fields**:
  - `approval_status`: `not_requested | pending | approved | denied | invalidated`.
  - `approver_login`: GitHub login of the reviewer.
  - `approver_membership_state`: `active | pending | absent | unknown`.
  - `approved_at`: Timestamp for approval decisions.
  - `decision_source`: Approval signal source such as issue comment command or workflow dispatch replay.
  - `decision_note`: Optional human justification.
- **Validation rules**:
  - `approval_status=not_requested` is valid while `request_status=waiting_for_attachment`.
  - Only the shared `intended_owner_login` may move status to `approved`.
  - Approval must be rechecked before mutation if the workflow is re-run.

## ReconciliationPlan

- **Purpose**: Represents the diff between current target organization team state and the approved desired state after the selected intake mode has been normalized into one requested-team list.
- **Fields**:
  - `organization_exists`: Boolean validation result.
  - `intake_mode`: `manual | csv_attachment` carried forward for audit consistency.
  - `current_teams`: Current teams discovered in the target organization.
  - `teams_to_create`: Requested teams absent from the target organization.
  - `teams_already_present`: Requested teams already present in the target organization.
  - `teams_rejected`: Requested teams blocked by validation or policy.
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
  - `created_count`: Number of successful team creations.
  - `noop_count`: Number of already-satisfied requested teams.
  - `failure_count`: Number of failed requested teams.
  - `duplicate_row_count`: Number of CSV rows deduplicated before reconciliation when `intake_mode=csv_attachment`.
  - `invalid_row_count`: Number of invalid CSV rows that blocked approval readiness when `intake_mode=csv_attachment`.
  - `rollback_status`: `not_needed | compensating_action_required | manual_follow_up_required`.
  - `summary`: Human-readable workflow result.
  - `artifact_path`: Stored audit artifact reference.
- **Validation rules**:
  - `created_count + noop_count + failure_count` should equal the number of validated requested teams that reached reconciliation.
  - `duplicate_row_count` and `invalid_row_count` are required for csv_attachment audit visibility even though they do not affect the downstream reconciliation count directly.
  - `terminal_state` becomes immutable for reprocessing purposes once it reaches `executed`, `partially_executed`, or `failed` after approved execution.