# Feature Specification: Add Child Teams CSV Attachment Intake

**Feature Folder**: `012-add-child-teams-csv-attachment`  
**Created**: 2026-05-25  
**Status**: Draft  
**Input**: User description: "Add CSV attachment intake mode to the existing add-child-teams IssueOps workflow while preserving all guarantees from specs/004-add-child-teams/spec.md and specs/008-add-child-teams-bulk-csv-mode/spec.md, following the attachment lifecycle pattern from specs/010-team-members-csv-attachment/spec.md and specs/011-create-org-teams-csv-attachment/spec.md."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Manual Requests and Safe Waiting Lifecycle (Priority: P1)

A requester can continue to use the manual add-child-teams flow without behavior changes, while requests choosing CSV attachment mode are safely held in a waiting state until a valid requester-authored attachment is accepted and validated.

**Why this priority**: This enhancement is acceptable only if baseline behavior from `specs/004-add-child-teams/spec.md` and preserved CSV semantics from `specs/008-add-child-teams-bulk-csv-mode/spec.md` remain non-regressive.

**Independent Test**: Submit one manual request and one `csv_attachment` request. Verify manual behavior is unchanged, and the attachment request remains blocked in `waiting_for_attachment` with no approval or mutation until an acceptable attachment comment is processed.

**Acceptance Scenarios**:

1. **Given** a requester selects `manual` intake and provides valid child-team entries, **When** validation runs, **Then** behavior remains equivalent to `specs/004-add-child-teams/spec.md`.
2. **Given** a requester selects `csv_attachment` intake and submits valid issue metadata without an attachment comment, **When** validation runs, **Then** the request status becomes `waiting_for_attachment` and no approval is requested.
3. **Given** a `csv_attachment` request has invalid baseline metadata (such as invalid organization, parent team, or approver), **When** validation runs, **Then** baseline validation failures are surfaced and no attachment processing can bypass them.

---

### User Story 2 - Accept, Validate, and Correct Attachment CSV Intake (Priority: P2)

A requester can provide high-volume child-team input by posting exactly one CSV attachment in a same-issue comment, and can correct invalid CSV by posting a newer requester-authored attachment comment after failed validation.

**Why this priority**: The enhancement value is high-volume intake through attachment comments, but only if it preserves strict provenance, validation safety, and row-level diagnostics.

**Independent Test**: Submit a `csv_attachment` request, post one qualifying requester attachment comment, observe row-level validation and approval readiness, then post a corrected requester attachment after a failed CSV attempt and verify supersession behavior.

**Acceptance Scenarios**:

1. **Given** a requester posts exactly one valid CSV attachment in a same-issue comment, **When** attachment validation runs, **Then** the CSV is downloaded, provenance is captured, rows are normalized, and the request advances from `waiting_for_attachment` to approval-ready if row validation succeeds.
2. **Given** a non-requester posts a CSV attachment on the issue, **When** attachment validation runs, **Then** the comment is ignored for progression and request state does not advance.
3. **Given** a requester posts a comment with ambiguous attachment candidates, no acceptable CSV candidate, oversized file, or non-decodable content, **When** validation runs, **Then** the workflow fails closed and keeps the request blocked.
4. **Given** CSV-content validation fails, **When** a later requester attachment comment is posted, **Then** the newest eligible requester attachment comment after the latest failed attachment-validation attempt becomes the active candidate.

---

### User Story 3 - Execute with Existing Approval/Reconciliation and Terminal-State Immutability (Priority: P3)

After a CSV attachment is accepted and validated, execution uses the same approval and reconciliation path as existing add-child-teams behavior; once execution reaches terminal state, later attachment comments are ignored and must not reopen approval lifecycle.

**Why this priority**: Attachment intake must not alter privileged execution guarantees or allow post-execution comments to reset state.

**Independent Test**: Approve and execute an attachment-driven request, then post new requester CSV attachments. Verify terminal requests remain immutable and do not transition back to `waiting_for_attachment` or `awaiting_approval`.

**Acceptance Scenarios**:

1. **Given** an approved attachment-driven request with mixed already-linked and missing child links, **When** execution runs, **Then** only missing links are applied and already-linked items remain no-op.
2. **Given** a request is already `executed`, `partially_executed`, or `failed` after approved execution, **When** a new requester CSV attachment comment is posted, **Then** the workflow ignores it and does not transition to any pre-execution state.
3. **Given** an approved attachment-driven request is rerun with no remaining drift, **When** reconciliation runs, **Then** the workflow reports idempotent no-op outcomes.

### Edge Cases

- Requester selects `csv_attachment` but never posts any qualifying attachment comment.
- Requester posts multiple attachments in one comment, or ambiguous attachment links in comment text.
- Attachment filename cannot be inferred reliably as `.csv` when filename inference is available.
- Attachment download succeeds but content is not UTF-8 decodable.
- Attachment exceeds configured size cap.
- Requester posts corrected attachment before earlier failure summary is observed, causing near-simultaneous candidates.
- Attachment contains missing `child_team` header, malformed rows, inconsistent column shape, blank rows, duplicate rows, or conflicting normalized slugs.
- Requester and approver are valid, but hierarchy drift changes between approval and execution.
- Request reaches executed terminal state, and later requester comments include valid attachments.
- GitHub API throttling occurs during comment reads, attachment discovery, or attachment download.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The enhancement MUST preserve manual-path behavior from `specs/004-add-child-teams/spec.md`.
- **FR-002**: The enhancement MUST preserve CSV row-level semantics from `specs/008-add-child-teams-bulk-csv-mode/spec.md` while moving high-volume intake from textarea to attachment comments.
- **FR-003**: The system MUST support intake modes `manual` and `csv_attachment`.
- **FR-004**: The system MUST continue to support manual requested-child-team intake without requiring attachments.
- **FR-005**: A `csv_attachment` request MUST begin in `waiting_for_attachment` when baseline metadata is valid but no accepted attachment has been processed.
- **FR-006**: Approval MUST NOT be requested or accepted while request status is `waiting_for_attachment`.
- **FR-007**: Accepted CSV attachment input MUST come from requester-authored comments on the same issue.
- **FR-008**: For an active validation attempt, exactly one qualifying attachment candidate MUST be accepted; ambiguous or multiple candidates in a comment MUST fail closed.
- **FR-009**: Attachment candidate selection MUST use the newest eligible requester attachment comment posted after the latest failed attachment-validation attempt.
- **FR-010**: Attachment validation MUST enforce bounded file-size limits and UTF-8 decodability before CSV parsing.
- **FR-011**: Accepted attachment CSV MUST preserve `child_team` header requirements and row-level handling from `specs/008-add-child-teams-bulk-csv-mode/spec.md`.
- **FR-012**: The system MUST capture provenance for accepted attachments: comment id, comment timestamp, uploader login, attachment URL, inferable filename when available, content hash, download timestamp, and rate-limit snapshot.
- **FR-013**: Non-requester, cross-issue, or non-qualifying comments MUST NOT advance request status.
- **FR-014**: After accepted attachment CSV passes validation, request progression MUST use the same approval, reconciliation, and execution semantics as baseline add-child-teams.
- **FR-015**: Re-parenting and cycle-creating requests MUST remain rejected as in baseline behavior.
- **FR-016**: Dry-run behavior MUST remain non-mutating while still producing reconciliation and audit output.
- **FR-017**: Requests in `executed`, `partially_executed`, or `failed` (post-approved execution) terminal states MUST NOT be reopened by later attachment comments.
- **FR-018**: Later attachment comments on terminal requests MUST be ignored and MUST NOT transition status back to `waiting_for_attachment`, `validation_failed`, or `awaiting_approval`.
- **FR-019**: The system MUST include operation-aware terminal label/status detection so fresh runners can enforce terminal-state ignore behavior deterministically.
- **FR-020**: The system MUST preserve clear status reporting across waiting, validation-failed, approval-pending, approved, executed, partially executed, and failed outcomes.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from issue submitter identity and reused for requester-only attachment acceptance checks.
- **AR-002**: Approval MUST remain centrally gated and require a single designated hierarchy approver for the full batch, consistent with `specs/004-add-child-teams/spec.md` and `specs/008-add-child-teams-bulk-csv-mode/spec.md`.
- **AR-003**: Central assignment remains routing-only and MUST NOT count as approval.
- **AR-004**: CSV attachment intake MUST NOT introduce per-row approvers or alternate approval paths.
- **AR-005**: Designated approver eligibility MUST still be verified against current organization/team-maintainer state before execution.
- **AR-006**: Execution MUST continue using `ISSUEOPS_GITHUB_TOKEN` with least-privilege access for validation, comment/attachment handling, and hierarchy mutation.

### Validation Strategy *(mandatory)*

- **VS-001**: Initial issue validation MUST apply baseline metadata validation before attachment lifecycle processing.
- **VS-002**: `csv_attachment` requests with valid metadata and no accepted attachment MUST enter `waiting_for_attachment`.
- **VS-003**: Attachment discovery MUST inspect issue comments and linked URLs conservatively and fail closed on ambiguity.
- **VS-004**: Only requester-authored same-issue comments may supply accepted attachment candidates.
- **VS-005**: Accepted attachment must pass file-level checks before CSV-content checks.
- **VS-006**: CSV-content validation MUST preserve 008 rules for headers, row parsing, normalization, duplicates/conflicts, blank rows, unsupported columns, and row findings.
- **VS-007**: Validation MUST emit 1-based data-row numbering excluding header row.
- **VS-008**: Failed CSV validation MUST block approval readiness until a later valid requester attachment is accepted.
- **VS-009**: Validation MUST ignore later attachment comments after terminal execution state is detected.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Reconciliation MUST read latest hierarchy state before mutation.
- **RL-002**: Desired state from accepted attachment rows MUST map to same normalized requested_child_links semantics as manual and 008 paths.
- **RL-003**: Apply only missing links; already-linked links remain no-op.
- **RL-004**: Reruns MUST remain idempotent and drift-aware.
- **RL-005**: Terminal-state requests MUST not re-enter reconciliation due to later attachments.

### Rollback Handling *(mandatory)*

- **RH-001**: Pre-mutation failures (including attachment discovery/download/CSV validation) MUST report zero-change outcomes.
- **RH-002**: Partial mutation failures MUST preserve per-link outcomes and operator follow-up guidance.
- **RH-003**: Workflow MUST fail closed when authorization, validation, approval, or attachment prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: Emit structured logs and artifacts for waiting state transitions, attachment acceptance decisions, CSV findings, approval decisions, reconciliation outcomes, and execution outcomes.
- **OR-002**: Include correlation and provenance fields required for audit: issue id, run id, requester, approver, organization, parent team, intake mode, terminal-state detection evidence, and attachment provenance.
- **OR-003**: Human-readable summaries MUST clearly indicate whether request is waiting for attachment, blocked by attachment or CSV validation, awaiting approval, or terminal.
- **OR-004**: Audit outputs MUST distinguish routing actions from authorization decisions.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Minimize API calls by limiting comment scanning and stopping candidate resolution once active candidate is determined.
- **GH-002**: Use bounded retry and backoff for retryable comment-read and attachment-download failures.
- **GH-003**: On non-retryable throttling scenarios, stop mutation, preserve partial evidence, and instruct operator retry.

### Testing Expectations *(mandatory)*

- **TE-001**: Verify manual-path non-regression against `specs/004-add-child-teams/spec.md`.
- **TE-002**: Verify CSV semantics non-regression against `specs/008-add-child-teams-bulk-csv-mode/spec.md`.
- **TE-003**: Verify waiting-for-attachment lifecycle and approval-blocking while waiting.
- **TE-004**: Verify requester-only attachment acceptance and ambiguous attachment fail-closed behavior.
- **TE-005**: Verify corrected resubmission flow selects newest eligible requester attachment after latest failed attempt.
- **TE-006**: Verify terminal-state immutability: executed or partially executed requests ignore later attachments and do not transition to `waiting_for_attachment` or `awaiting_approval`.
- **TE-007**: Verify no-op reruns, partial-failure reporting, dry-run behavior, and bounded rate-limit handling remain safe and auditable.

### Key Entities *(include if feature involves data)*

- **Team Hierarchy Request**: Existing request entity extended with intake mode and attachment-aware waiting lifecycle.
- **CSV Attachment Submission**: Provenance-tracked attachment candidate tied to requester comment context.
- **CSV Attachment Validation Attempt**: One evaluation cycle of attachment selection and CSV-content validation, including supersession behavior.
- **CSV Row Finding**: Per-row validation detail consistent with 008 semantics.
- **Hierarchy Reconciliation Result**: Existing mutation/no-op/rejected/failed outcome record reused unchanged after normalization.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid manual requests preserve baseline 004 behavior without requester workflow changes.
- **SC-002**: 95% of syntactically valid requester attachment submissions with valid metadata reach approval-ready state on first valid attachment attempt.
- **SC-003**: 100% of requests in `waiting_for_attachment` remain blocked from approval and mutation.
- **SC-004**: 100% of execution attempts without valid designated-approver approval remain blocked.
- **SC-005**: 100% of post-terminal attachment comments are ignored for reprocessing and do not reopen lifecycle states.
- **SC-006**: For completed attachment-driven runs, stakeholders can identify attachment provenance, row-level outcomes, and final mutation/no-op/failure results without inspecting raw logs.

## Assumptions

- `specs/004-add-child-teams/spec.md` remains baseline source of truth for unchanged add-child-teams behavior.
- `specs/008-add-child-teams-bulk-csv-mode/spec.md` remains source of truth for preserved CSV schema and row semantics.
- Attachment lifecycle pattern from `specs/010-team-members-csv-attachment/spec.md` and `specs/011-create-org-teams-csv-attachment/spec.md` is reusable for add-child-teams with operation-specific constraints.
- GitHub issue attachments are discoverable via issue/comment-linked URLs; no dedicated issue-attachment API object is assumed.
- One organization, one parent team, and one designated approver remain request-scoped boundaries.
- Team creation/member management/repo access changes remain out of scope.
