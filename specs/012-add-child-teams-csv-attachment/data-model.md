# Data Model: Add Child Teams CSV Attachment Intake

## TeamHierarchyRequest

- Purpose: Existing add-child-teams request record extended with intake mode and attachment lifecycle state while preserving baseline parent/child validation, designated approver model, and execution outcomes.
- Fields:
  - request_id: Stable identifier derived from issue number and run context.
  - issue_number: GitHub issue number.
  - repository: Repository hosting the request.
  - requester_login: GitHub login of issue requester.
  - organization: Target organization slug.
  - parent_team: Requested parent team slug or canonical identifier.
  - designated_hierarchy_approver: Single login that must approve the full batch.
  - intake_mode: manual | csv_attachment.
  - requested_child_teams_input: Manual raw child-team field when intake_mode is manual.
  - accepted_attachment_submission: Accepted attachment provenance when intake_mode is csv_attachment.
  - requested_child_links: Normalized child-link set used by downstream approval and reconciliation.
  - request_status: submitted | waiting_for_attachment | validation_failed | awaiting_approval | approved | denied | executed | partially_executed | failed_after_approved_execution.
  - submitted_at: Initial intake timestamp.
- Validation rules:
  - Exactly one intake mode must be selected.
  - parent_team and designated_hierarchy_approver are required.
  - At least one normalized requested child link is required for approval readiness.
  - csv_attachment requests require accepted_attachment_submission before approval can be requested.
  - failed_after_approved_execution is reserved for failures after approval has already authorized mutation execution.

## CsvAttachmentSubmission

- Purpose: Provenance record for one accepted requester attachment candidate.
- Fields:
  - comment_id: Issue comment identifier.
  - comment_created_at: Comment timestamp.
  - uploader_login: Comment author login.
  - attachment_url: URL resolved from comment content.
  - filename: Inferable filename when available.
  - extension: Inferred extension; expected csv for accepted candidates.
  - byte_size: Downloaded size or validated size measurement.
  - content_hash: Deterministic hash of attachment content.
  - downloaded_at: Download timestamp.
  - acceptance_status: waiting | accepted | rejected | superseded | ignored_terminal_state.
  - rejection_reason: Optional rejection classification.
- Validation rules:
  - uploader_login must equal requester_login.
  - Exactly one candidate can be accepted for an active attempt.
  - Accepted candidate must pass size, decode, and CSV file checks.

## CsvAttachmentValidationAttempt

- Purpose: One processing cycle covering candidate selection and CSV-content validation.
- Fields:
  - attempt_id: Stable attempt id.
  - request_id: Parent request.
  - candidate_comment_id: Comment being evaluated.
  - attempt_status: waiting | attachment_rejected | csv_invalid | csv_valid | superseded | ignored_terminal_state.
  - selection_rule: Applied deterministic selection rule.
  - evaluated_at: Attempt timestamp.
  - errors: Blocking failures.
  - warnings: Non-blocking findings.
  - supersedes_attempt_id: Prior attempt superseded by later requester comment.
- Validation rules:
  - csv_valid requires accepted attachment provenance and at least one valid child row.
  - csv_invalid blocks approval readiness until a later eligible requester comment is processed.

## BulkCsvSubmission

- Purpose: Schema and row-parsing results from accepted attachment content before normalization into requested_child_links.
- Fields:
  - encoding: utf-8.
  - header_columns: Parsed and normalized header set.
  - required_columns: Required header set containing child_team.
  - unsupported_columns: Unsupported columns detected.
  - row_count: Number of data rows excluding header.
  - valid_row_count: Rows accepted for normalization.
  - invalid_row_count: Rows blocking approval readiness.
  - duplicate_row_count: Rows deduplicated or flagged as conflicting.
  - schema_status: waiting | valid | invalid.
  - schema_errors: Payload-level failures.
  - csv_row_findings: Per-row validation outcomes.
  - csv_row_numbering_convention: Description of 1-based numbering excluding header row.
- Validation rules:
  - child_team must be present as required header.
  - Unsupported columns are rejected for this feature scope.
  - Blank rows are tracked but do not mutate requested_child_links.

## CsvRowFinding

- Purpose: Row-level diagnostic record for one attachment CSV data row.
- Fields:
  - row_number: 1-based data row excluding header.
  - original_row: Raw row payload.
  - child_team: Parsed child-team value when available.
  - normalized_slug: Normalized slug when derivable.
  - validation_status: valid | duplicate | invalid | blank.
  - failure_reason: Optional reason classification.
- Validation rules:
  - Each non-header row yields exactly one finding.
  - Invalid rows block approval readiness.

## RequestedChildLink

- Purpose: Normalized unit of intended parent-child relationship after manual or attachment ingestion.
- Fields:
  - parent_team: Requested parent team slug.
  - child_team_name: Child team display input.
  - child_team_slug: Normalized child-team slug.
  - source_row_number: Optional source CSV row number.
  - source_comment_id: Optional accepted attachment comment id.
  - validation_status: valid | duplicate | conflicting | already_linked | reparent_required | cycle_risk | rejected.
  - desired_action: link_child | noop | reject.
  - execution_result: not_started | linked | noop | failed.
  - failure_reason: Optional mutation failure reason.
- Validation rules:
  - child_team_slug must be unique after normalization.
  - Links requiring re-parenting or cycle creation are rejected.

## ApprovalDecision

- Purpose: Approval state for full request batch using existing designated hierarchy approver model.
- Fields:
  - approval_status: not_requested | pending | approved | denied | invalidated.
  - approver_login: Approver identity.
  - approver_eligibility: valid | invalid | unknown.
  - approved_at: Approval timestamp.
  - decision_source: Trigger source.
  - decision_note: Optional context.
- Validation rules:
  - Approval cannot transition to approved while request_status is waiting_for_attachment or validation_failed.
  - approver_login must equal designated_hierarchy_approver and pass current org/team-maintainer checks.

## ReconciliationPlan

- Purpose: Desired-vs-current hierarchy diff used to apply only missing links.
- Fields:
  - organization_exists: Boolean org visibility check.
  - parent_exists: Boolean parent team existence check.
  - intake_mode: manual | csv_attachment.
  - links_to_apply: Requested child links not yet present.
  - links_already_present: Requested links already satisfied.
  - links_rejected: Links blocked by policy or validation.
  - dry_run: Simulation flag.
  - rate_limit_snapshot: Latest headers used for retry decisions.
- State transitions:
  - draft -> validated.
  - validated -> awaiting_approval.
  - awaiting_approval -> approved_for_execution.
  - approved_for_execution -> executed | partially_executed | failed_after_approved_execution.

## ExecutionOutcome

- Purpose: Durable outcome for requester-facing and audit reporting.
- Fields:
  - run_id: GitHub Actions run id.
  - run_attempt: Run attempt number.
  - intake_mode: manual | csv_attachment.
  - terminal_state: not_started | waiting_for_attachment | validation_failed | executed | partially_executed | failed_after_approved_execution.
  - applied_count: Number of links successfully created.
  - noop_count: Number of links already satisfied.
  - rejected_count: Number of links rejected pre-mutation.
  - failed_count: Number of links failing during mutation.
  - duplicate_row_count: Attachment CSV duplicate count when applicable.
  - invalid_row_count: Attachment CSV invalid row count when applicable.
  - rollback_status: not_needed | compensating_action_required | manual_follow_up_required.
  - summary: Human-readable outcome.
  - artifact_path: Persisted audit artifact reference.
- Validation rules:
  - applied_count + noop_count + failed_count must equal links that reached reconciliation execution scope.
  - terminal_state becomes immutable for attachment reprocessing once it is executed, partially_executed, or failed_after_approved_execution.
