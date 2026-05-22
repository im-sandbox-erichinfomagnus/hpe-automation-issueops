# Feature Specification: Create Organization Teams CSV Attachment Intake

**Feature Folder**: `011-create-org-teams-csv-attachment`  
**Created**: 2026-05-22  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for adding a CSV attachment intake mode to the existing create-org-teams IssueOps workflow. The new spec should model the enhancement pattern used by the add-team-members CSV attachment work, but applied to create-org-teams. The specification must be explicitly non-regressive with respect to the existing baseline and bulk-CSV specs."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Manual Requests and Hold Attachment Requests Safely (Priority: P1)

A requester continues to submit standard create-org-teams requests through the existing manual path, while a requester who chooses CSV attachment intake gets a safe waiting-for-attachment result instead of premature approval or mutation.

**Why this priority**: This enhancement is acceptable only if the existing manual workflow remains behaviorally equivalent to `specs/003-create-org-teams/spec.md`, and attachment-driven requests fail closed until all required intake material is present and validated.

**Independent Test**: Can be fully tested by submitting one manual request and one `csv_attachment` request, then verifying that the manual request behaves as before while the attachment request remains blocked in a waiting-for-attachment state with no approval eligibility or team creation.

**Acceptance Scenarios**:

1. **Given** a requester selects `manual` intake mode and provides valid requested team names, **When** the request is submitted, **Then** the workflow processes the request with behavior equivalent to `specs/003-create-org-teams/spec.md`.
2. **Given** a requester selects `csv_attachment` intake mode and submits valid request metadata without a CSV comment yet, **When** initial validation runs, **Then** the workflow marks the request as waiting for attachment, does not request approval, and does not create teams.
3. **Given** a requester selects `csv_attachment` intake mode but the target organization or intended owner metadata is invalid, **When** initial validation runs, **Then** the workflow rejects the request using the same metadata requirements already defined for the baseline feature.

---

### User Story 2 - Submit and Correct High-Volume Team Creation Requests Through CSV Attachments (Priority: P2)

A requester uploads a CSV file as an attachment in a comment on the same issue so that large team-creation batches can be validated without pasting the CSV into the issue form, and can correct invalid CSV content by posting a later attachment comment.

**Why this priority**: The user-experience improvement depends on moving high-volume input out of the issue form while preserving the CSV schema, row-level validation behavior, and approval readiness guarantees already established by `specs/007-create-org-teams-bulk-csv-mode/spec.md`.

**Independent Test**: Can be fully tested by submitting a `csv_attachment` request, posting a requester comment with one CSV attachment, validating acceptance and row-level findings, then posting a corrected attachment in a second comment after a validation failure and confirming that the newer eligible attachment supersedes the failed attempt.

**Acceptance Scenarios**:

1. **Given** a requester submits a `csv_attachment` request and later posts exactly one valid `.csv` attachment in a comment on the same issue, **When** comment-driven validation runs, **Then** the workflow downloads the attachment, records provenance, normalizes the rows into the standard requested-team model, and marks the request ready for approval review.
2. **Given** a commenter other than the original requester posts a CSV attachment on the same issue, **When** comment-driven validation runs, **Then** the workflow ignores that attachment for request advancement and leaves the request blocked.
3. **Given** a requester comment contains no acceptable CSV attachment, multiple CSV attachments, or an ambiguous attachment set, **When** validation runs, **Then** the workflow fails closed, reports why the attachment was not accepted, and does not request approval.
4. **Given** an accepted CSV attachment contains malformed rows, missing required headers, duplicate or conflicting team names, invalid team definitions, or unsupported columns, **When** validation runs, **Then** the workflow reports row-level findings and requires the requester to post a corrected attachment in a later comment rather than replacing the original attempt in place.
5. **Given** a requester posts a corrected CSV attachment in a later comment after a failed attachment validation, **When** validation runs again, **Then** the workflow uses the newest requester attachment comment posted after the latest failed CSV-attachment validation result as the active attachment candidate.

---

### User Story 3 - Execute Validated Attachment-Driven Requests with Existing Approval and Reconciliation Rules (Priority: P3)

After a CSV attachment has been accepted and validated, an intended owner and requester can rely on the request to execute with the same approval gate, reconciliation-first mutation, idempotent rerun, and audit behavior as the existing create-org-teams workflow, while later attachment comments no longer re-open completed execution.

**Why this priority**: CSV attachment intake changes only how high-volume input is supplied. Approval and execution semantics must remain aligned with the baseline create-org-teams workflow and the bulk CSV guarantees from `specs/007-create-org-teams-bulk-csv-mode/spec.md`.

**Independent Test**: Can be fully tested by approving a valid attachment-driven request where some requested teams already exist, verifying no-op and changed outcomes match the manual path, and then posting another attachment comment after execution to confirm the completed request does not run again.

**Acceptance Scenarios**:

1. **Given** an approved attachment-driven request where some requested teams already exist, **When** execution runs, **Then** the workflow creates only missing teams and reports already-satisfied teams as no-op outcomes.
2. **Given** a previously approved attachment-driven request is re-run after all requested teams already exist, **When** reconciliation runs again, **Then** the workflow performs no duplicate team creation and reports an idempotent no-op result.
3. **Given** the workflow has already reached an executed terminal state for an attachment-driven request, **When** additional CSV attachments are posted in later comments, **Then** the workflow does not start a new validation, approval, or execution cycle for that completed request.

### Edge Cases

- A requester selects `csv_attachment` intake mode but never posts any qualifying attachment comment.
- A requester posts a comment with multiple `.csv` attachments, a CSV plus non-CSV files, or attachment links whose filenames cannot be inferred safely.
- A requester edits the original issue body or an earlier comment after an attachment validation failure instead of posting a second corrective comment.
- A non-requester, bot, or approver posts a CSV attachment comment on the issue before or after the requester posts one.
- A requester posts a corrected CSV attachment before the previous validation summary is visible, creating closely spaced competing attachment comments.
- The accepted attachment URL can be discovered from comment content, but the file cannot be downloaded, hashed, or decoded as UTF-8 text.
- An attachment exceeds the configured size cap, resolves to non-CSV content, or produces content whose filename extension and body content conflict.
- A valid CSV attachment is accepted while the underlying target organization or current team state changes before execution.
- The accepted CSV contains only teams that already exist, only duplicate rows, or a mix of valid, duplicate, conflicting, and malformed rows.
- The workflow receives unrelated issue comments, deleted comments, or attachment-free comments while the request is waiting for attachment.
- The workflow reaches an executed terminal state and later receives additional requester CSV comments that would otherwise be syntactically valid.
- The workflow encounters GitHub API throttling while reading the issue, comment history, or attachment content for a high-volume request.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The enhancement MUST explicitly preserve the behavior defined in `specs/003-create-org-teams/spec.md` for requests that use the supported manual intake path.
- **FR-002**: The enhancement MUST explicitly preserve the CSV schema, normalization behavior, row-level validation semantics, reconciliation guarantees, and non-regression expectations defined in `specs/007-create-org-teams-bulk-csv-mode/spec.md`, even though textarea-based bulk CSV intake is superseded for new requests.
- **FR-003**: The system MUST expose an intake mode selector for create-org-teams requests with supported values equivalent to `manual` and `csv_attachment`.
- **FR-004**: The system MUST continue to support the existing manual requested-team-names path for small requests without requiring CSV attachment intake.
- **FR-005**: This enhancement MUST supersede the textarea-based bulk CSV intake for new create-org-teams requests while preserving the preserved CSV semantics and guarantees from `specs/007-create-org-teams-bulk-csv-mode/spec.md`.
- **FR-006**: The system MUST require exactly one supported intake mode per request.
- **FR-007**: If `csv_attachment` intake mode is selected, the initial issue submission MUST be accepted only when request metadata is otherwise valid and MUST place the request into a waiting-for-attachment state until a qualifying requester attachment comment is processed.
- **FR-008**: A request in the waiting-for-attachment state MUST NOT become approval-ready and MUST NOT create teams.
- **FR-009**: The system MUST require the requester to provide the CSV as exactly one attachment in a comment on the same issue after the issue is created.
- **FR-010**: The system MUST accept an attachment-driven request only when the qualifying attachment comment was posted by the original requester.
- **FR-011**: The system MUST reject or ignore attachment candidates from other commenters, other issues, ambiguous attachment sets, or comments that do not contain exactly one qualifying CSV attachment.
- **FR-012**: The accepted attachment MUST be a CSV file and MUST have a `.csv` filename extension when the filename can be inferred from the attachment URL or related metadata.
- **FR-013**: The system MUST enforce a bounded attachment size limit for CSV intake and MUST reject oversized attachments before approval or mutation.
- **FR-014**: The system MUST discover GitHub issue attachments operationally from issue or comment content and linked URLs, rather than assuming a dedicated first-class issue-attachment API resource exists.
- **FR-015**: The system MUST download accepted attachment content before CSV parsing and validation.
- **FR-016**: The system MUST hash the downloaded attachment content and preserve attachment provenance in the audit evidence, including attachment URL, issue comment id, uploader login, filename if inferable, content hash, and download timestamp.
- **FR-017**: The system MUST fail closed when an attachment cannot be safely identified, downloaded, decoded, hashed, or parsed.
- **FR-018**: The attachment-driven CSV schema MUST require a `team_name` column and MUST preserve the same row-level semantics established in `specs/007-create-org-teams-bulk-csv-mode/spec.md`.
- **FR-019**: The system MUST normalize valid attachment-derived team rows into the same requested-team semantic model used by the existing create-org-teams workflow.
- **FR-020**: The system MUST preserve row-level validation findings with 1-based data-row numbers that exclude the header row.
- **FR-021**: If CSV-content validation fails, the system MUST leave the request non-approval-ready and require the requester to post a corrected attachment in a later comment rather than replacing the original attachment attempt in place.
- **FR-022**: After a failed CSV-content validation, the system MUST use the newest requester attachment comment posted after the latest failed CSV-attachment validation result as the active attachment candidate for correction.
- **FR-023**: Once an attachment-driven request passes validation, the system MUST route it through the same approval, reconciliation, mutation, no-op, and audit flow as manual requests.
- **FR-024**: The workflow MUST continue to create empty teams only and MUST NOT accept, model, or process team members as part of this enhancement.
- **FR-025**: Parent-team configuration, multi-organization batches, and multi-owner approval models MUST remain out of scope unless already allowed by `specs/003-create-org-teams/spec.md` or `specs/007-create-org-teams-bulk-csv-mode/spec.md`.
- **FR-026**: After the workflow reaches an executed terminal state for the request, later attachment comments MUST NOT trigger a new validation, approval, or execution cycle.
- **FR-027**: The system MUST preserve clear completion and blocking reports that distinguish waiting-for-attachment, invalid attachment, invalid CSV content, approval-pending, successful creation, no-op teams, rejected rows, duplicate or conflicting rows, and failed rows.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST continue to be derived from the GitHub user who submitted the issue, independent of intake mode.
- **AR-002**: Approval MUST remain centrally gated in the central repository and MUST continue to require the single intended owner shared across the full request batch, exactly as defined in `specs/003-create-org-teams/spec.md`.
- **AR-003**: CSV attachment intake MUST NOT introduce per-row intended owners or any alternate approval path that weakens the existing batch approval guarantee.
- **AR-004**: The executing workflow identity MUST continue to use `ISSUEOPS_GITHUB_TOKEN` as the privileged credential for target-state validation, approver verification, attachment processing, and team creation unless a later enhancement explicitly changes that model.
- **AR-005**: Authorization checks MUST continue to verify requester context and approver eligibility before mutation, and csv_attachment intake MUST NOT bypass or weaken those checks.
- **AR-006**: Attachment acceptance MUST verify that the qualifying CSV comment was authored by the original requester on the same issue before the attachment can influence approval readiness or execution.

### Validation Strategy *(mandatory)*

- **VS-001**: The request payload MUST be parsed into structured fields for organization, intended owner, intake mode, and normalized requested teams before any mutation step is eligible to run.
- **VS-002**: Preflight validation for manual requests MUST remain behaviorally equivalent to `specs/003-create-org-teams/spec.md`.
- **VS-003**: Preflight validation for `csv_attachment` requests MUST verify valid intake metadata first, then place the request into a waiting-for-attachment state until a qualifying attachment comment exists.
- **VS-004**: Comment-driven validation for `csv_attachment` requests MUST inspect relevant comment content, identify eligible attachment links conservatively, and reject ambiguous or non-qualifying attachment sets.
- **VS-005**: Comment-driven validation MUST accept only the newest requester attachment comment posted after the latest failed CSV-attachment validation result, unless the request is already in an executed terminal state.
- **VS-006**: Attachment validation MUST verify the attachment can be downloaded safely, stays within the configured size cap, decodes as UTF-8 text, and is suitable for CSV parsing before row-level validation begins.
- **VS-007**: CSV-content validation for accepted attachments MUST preserve the same header validation, row-shape handling, blank-row handling, duplicate handling, conflicting-slug handling, unsupported-column handling, and row numbering semantics established in `specs/007-create-org-teams-bulk-csv-mode/spec.md`.
- **VS-008**: CSV-content validation MUST evaluate each non-blank row and record a 1-based data-row number that excludes the header row, the parsed team name when available, the normalized slug when available, and the failure reason for every invalid row.
- **VS-009**: Preflight validation MUST confirm that the target organization exists and that the intended owner remains valid in the target organization context before approval can unlock execution.
- **VS-010**: Validation results for csv_attachment requests MUST expose waiting-state details, attachment-provenance findings, aggregate CSV counts, and row-level findings to reviewers before approval is used to authorize execution.
- **VS-011**: Comments without an acceptable attachment MUST NOT advance the request.
- **VS-012**: Validation logic MUST ignore later attachment comments once the request has reached an executed terminal state.

### Reconciliation Logic *(mandatory)*

- **RL-001**: The system MUST read the current team state from the target organization before applying any approved change, regardless of intake mode.
- **RL-002**: Desired state for csv_attachment requests MUST be derived from the normalized requested-team list produced by the accepted CSV attachment and MUST match the same desired-state semantics used by manual requests.
- **RL-003**: The system MUST create only the requested teams that do not already exist.
- **RL-004**: The system MUST leave already-existing teams unchanged and report them as no-op outcomes.
- **RL-005**: Re-running the same approved attachment-driven request MUST converge without duplicate team creation or conflicting outcomes.
- **RL-006**: If current state changes between approval and execution, the system MUST recalculate drift from the latest available organization state before attempting team creation.
- **RL-007**: Executed terminal state MUST represent a request whose approved execution path has already reached a final completed, partial-complete, or failed-after-execution outcome and therefore must not be reopened by later attachment comments.

### Rollback Handling *(mandatory)*

- **RH-001**: If a csv_attachment request fails before any team creation occurs, including attachment discovery, download, or CSV validation failure, the system MUST report a zero-change blocking or failure result.
- **RH-002**: If execution partially succeeds for an attachment-driven request, the system MUST record which teams were created and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when approval, validation, authorization, attachment-discovery, or attachment-download prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured execution evidence for the request, chosen intake mode, waiting-for-attachment status, attachment acceptance decision, validation outcome, approval decision, reconciliation decision, and final team-creation result.
- **OR-002**: Observability outputs MUST include the issue or request identifier, workflow run identifier, requester, approver, target organization, intended owner, intake mode, attachment URL, attachment comment id, attachment uploader login, attachment filename if inferable, attachment content hash, download timestamp, requested team count, duplicate row count, invalid row count, created team count, and no-op team count.
- **OR-003**: The system MUST present a human-readable summary back to the requester and approvers that identifies whether the request is waiting for an attachment, blocked by attachment validation, blocked by CSV-content validation, approval-ready, or completed.
- **OR-004**: Audit evidence MUST make clear that GitHub issue attachments were discovered from issue or comment content and downloaded via linked URLs rather than through a dedicated first-class issue-attachment API resource.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary GitHub API calls by ignoring irrelevant comments, stopping attachment searches once the active candidate is determined, and normalizing and deduplicating team names before organization and existing-team lookups are made.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered during issue or comment reads, attachment download, validation, or reconciliation.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify that manual intake remains behaviorally equivalent to the baseline `003-create-org-teams` feature.
- **TE-002**: Tests MUST verify that csv_attachment preserves the CSV normalization and validation semantics established in `specs/007-create-org-teams-bulk-csv-mode/spec.md`.
- **TE-003**: Tests MUST verify initial `csv_attachment` requests enter and remain in a waiting-for-attachment state until a qualifying requester attachment comment is processed.
- **TE-004**: Tests MUST verify that attachment comments from non-requesters, other issues, or comments without an acceptable CSV attachment are rejected or ignored without advancing the request.
- **TE-005**: Tests MUST verify rejection of non-CSV attachments, ambiguous multi-attachment comments, and oversized attachments when a size cap applies.
- **TE-006**: Tests MUST verify valid and invalid attachment-driven CSV parsing, including header validation, malformed row handling, blank-row handling, duplicate-row handling, conflicting-slug handling, invalid-team handling, and provenance capture.
- **TE-007**: Tests MUST verify that invalid CSV-content results require a corrected attachment in a later comment and that the newest eligible requester attachment comment after the latest failed CSV-attachment validation result supersedes the earlier failed attempt.
- **TE-008**: Tests MUST verify that approval remains blocked until the accepted attachment passes validation and that execution remains blocked until the valid intended owner approves the request.
- **TE-009**: Tests MUST verify reconciliation behavior for attachment-driven requests with all-new teams, partially satisfied requests, and fully satisfied reruns.
- **TE-010**: Tests MUST verify row-level validation reporting, waiting-state summaries, audit outputs, partial failure reporting, bounded retry behavior, and rate-limit handling outcomes for csv_attachment requests.
- **TE-011**: Tests MUST verify that additional attachment comments posted after an executed terminal state do not cause the request to be processed again.

### Key Entities *(include if feature involves data)*

- **Team Creation Request**: The existing request record for create-org-teams, extended to capture the selected intake mode, waiting-for-attachment state, accepted attachment provenance, approval state, validation outcome, and execution outcome while preserving the baseline request fields from `specs/003-create-org-teams/spec.md`.
- **CSV Attachment Submission**: A requester-authored issue comment attachment candidate for one create-org-teams request, including the linked attachment URL, comment identifier, uploader identity, inferable filename, download metadata, content hash, and acceptance status.
- **CSV Attachment Validation Attempt**: A validation result associated with one attachment-processing cycle that records whether the attachment candidate was accepted, rejected, superseded, or blocked by CSV-content findings.
- **CSV Row Finding**: A validation record for an individual CSV data row that captures the 1-based row number excluding the header row, original row content, normalized team name if available, normalized slug if available, validation status, and failure reason.
- **Team Creation Reconciliation Result**: The existing summary of current-state findings, teams created, no-op teams, failed teams, and required follow-up action, reused unchanged after attachment CSV parsing normalizes the request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid manual requests continue to reach the same validation and approval-gating behavior defined by `specs/003-create-org-teams/spec.md` without requiring changes in requester behavior.
- **SC-002**: 95% of syntactically valid csv_attachment requests with an acceptable requester attachment, a visible target organization, a valid intended owner, and non-conflicting team rows reach an approval-ready state without operator intervention on the first valid attachment attempt.
- **SC-003**: 100% of csv_attachment requests without an accepted and validated requester attachment remain blocked from approval and team creation.
- **SC-004**: 100% of execution attempts without approval from the valid intended owner remain blocked from creating teams for both manual and csv_attachment intake modes.
- **SC-005**: 100% of repeated executions for already-satisfied attachment-driven requests complete without duplicate team creation.
- **SC-006**: 100% of requester attachment comments posted after an executed terminal state are ignored for reprocessing purposes.
- **SC-007**: For completed attachment-driven runs, requesters and approvers can determine from the recorded outcome which attachment was used, which rows were accepted or rejected, and which teams were created, skipped, rejected, or failed without inspecting raw system internals.

## Assumptions

- `specs/003-create-org-teams/spec.md` remains the authoritative baseline for all unchanged create-org-teams behavior.
- `specs/007-create-org-teams-bulk-csv-mode/spec.md` remains the authoritative source for preserved CSV normalization and row-level validation semantics even though this enhancement supersedes the textarea-based bulk CSV intake for new requests.
- Requests continue to be submitted by authenticated GitHub users through the repository's standard IssueOps issue and comment flow.
- The target organization and intended owner remain request-scoped fields outside the CSV attachment so the workflow continues to process one organization and one approval authority per request.
- GitHub issue attachments are operationally available through links embedded in issue or comment content rather than through a dedicated first-class issue-attachment API resource.
- This workflow continues to create empty teams only; adding members, configuring parent-team hierarchy, and processing multi-organization or multi-owner batches remain out of scope for this enhancement.
- A repository-level bounded attachment size limit is available or can be defined for safe CSV intake.
- `ISSUEOPS_GITHUB_TOKEN` remains available with sufficient permission to validate organization state, verify the intended owner, inspect issue and comment content, download accepted attachments, and create missing teams.