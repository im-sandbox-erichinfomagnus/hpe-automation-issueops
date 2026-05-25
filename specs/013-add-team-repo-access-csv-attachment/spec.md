# Feature Specification: Add Team Repo Access CSV Attachment Intake

**Feature Branch**: `013-setup-feature-branch`  
**Created**: 2026-05-25  
**Status**: Draft  
**Input**: User description: "Add CSV attachment intake mode to existing add-team-repo-access workflow with strict non-regression against specs 005 and 009, and terminal-state immutability based on latest attachment implementations."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Manual Requests and Safe Waiting Lifecycle (Priority: P1)

A requester can continue to submit add-team-repo-access requests through the existing manual path with behavior equivalent to `specs/005-add-team-repo-access/spec.md`, while requests choosing `csv_attachment` are held in `waiting_for_attachment` until a qualifying attachment is accepted and validated.

**Why this priority**: This enhancement is acceptable only if manual non-regression is guaranteed and attachment-driven requests remain blocked from approval and mutation until intake is complete.

**Independent Test**: Submit one manual request and one `csv_attachment` request. Verify manual behavior remains equivalent to `specs/005-add-team-repo-access/spec.md` and `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` semantics, while the attachment request stays blocked in waiting state.

**Acceptance Scenarios**:

1. **Given** a requester selects `manual` intake and provides valid repositories, team, organization, permission, and designated approver, **When** validation runs, **Then** behavior remains equivalent to `specs/005-add-team-repo-access/spec.md`.
2. **Given** a requester selects `csv_attachment` intake and submits valid metadata without a qualifying attachment comment, **When** validation runs, **Then** request status becomes `waiting_for_attachment`, approval remains blocked, and no repository permission mutation occurs.
3. **Given** a requester selects `csv_attachment` intake but baseline metadata is invalid, **When** validation runs, **Then** baseline validation failures are surfaced and attachment processing does not bypass those failures.

---

### User Story 2 - Accept, Validate, and Correct CSV Attachment Intake (Priority: P2)

A requester can submit high-volume repository entries via one CSV attachment in a same-issue comment, with strict requester-only acceptance, deterministic candidate selection, row-level findings, and correction via a newer requester attachment comment after failed validation.

**Why this priority**: High-volume usability is the enhancement goal, but only if CSV semantics from `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` are preserved and validation remains fail-closed.

**Independent Test**: Submit a `csv_attachment` request, post one valid requester CSV attachment, observe approval readiness, then post an invalid CSV followed by a corrected requester attachment and verify supersession behavior.

**Acceptance Scenarios**:

1. **Given** a requester posts exactly one valid CSV attachment in a same-issue comment, **When** attachment validation runs, **Then** the workflow accepts it, captures provenance, applies preserved CSV normalization semantics from `specs/009-add-team-repo-access-bulk-csv-mode/spec.md`, and advances to approval-ready if validation succeeds.
2. **Given** a non-requester posts CSV attachment comments, **When** attachment validation runs, **Then** those comments do not advance request status.
3. **Given** an attachment candidate is ambiguous, oversized, non-decodable, malformed, or fails CSV-content validation, **When** validation runs, **Then** the request remains blocked and reports row-level and attempt-level findings.
4. **Given** a failed attachment-validation attempt exists, **When** a newer eligible requester CSV attachment comment is posted, **Then** the newest eligible comment after the latest failure is selected as the active candidate.

---

### User Story 3 - Execute with Existing Approval/Reconciliation and Terminal-State Immutability (Priority: P3)

After a CSV attachment is accepted and validated, execution uses the same approval and reconciliation guarantees as the baseline add-team-repo-access flow, and later attachment comments are ignored once request execution reaches terminal state.

**Why this priority**: Intake changes must not weaken approval governance, reconciliation safety, or idempotency, and completed requests must not be reopened by later comments.

**Independent Test**: Approve and execute an attachment-driven request with mixed missing/satisfied repositories, rerun idempotently, then post another requester CSV attachment and verify the request remains terminal.

**Acceptance Scenarios**:

1. **Given** an approved attachment-driven request with some missing grants and some already-satisfied repositories, **When** execution runs, **Then** only missing eligible grants are applied and already-satisfied entries remain no-op.
2. **Given** request status is terminal (`executed`, `partially_executed`, or `failed_after_approved_execution`), **When** a new requester CSV attachment comment is posted, **Then** the request does not transition back to pre-execution states and the comment is recorded as ignored due to terminal state.
3. **Given** an approved attachment-driven request is rerun with no remaining drift, **When** reconciliation runs, **Then** execution remains idempotent and reports no duplicate grants.

### Edge Cases

- Requester selects `csv_attachment` but never posts a qualifying attachment comment.
- Comment contains multiple CSV attachments or ambiguous attachment links.
- Attachment filename cannot be inferred safely as CSV where filename inference is available.
- Attachment exceeds configured size cap.
- Attachment cannot be decoded as UTF-8.
- CSV is missing required header `repository`.
- CSV contains unsupported columns implying row-level organization, team, permission, or approver overrides.
- CSV contains malformed rows or inconsistent column counts.
- CSV contains blank rows, duplicate rows, or conflicting normalized repository identifiers.
- Target organization, team, or one or more repositories are missing or not visible.
- Requested repositories include archived or otherwise ineligible repositories.
- Existing permission is weaker/conflicting and would require modification/downgrade.
- Existing permission is exact or stronger and must be treated as satisfied no-op.
- Approval commenter is not authorized under baseline approver model.
- Request would require multiple different approvers and must be rejected as non-approvable batch.
- `ISSUEOPS_GITHUB_TOKEN` is missing or insufficient for required read/write operations.
- State changes between approval and execution (stale state drift).
- Later requester CSV attachments are posted after terminal execution state.
- GitHub API throttling occurs during comment reads, attachment download, validation, or mutation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The enhancement MUST preserve manual-path behavior from `specs/005-add-team-repo-access/spec.md`.
- **FR-002**: The enhancement MUST preserve CSV schema, normalization, row-level findings, and validation semantics from `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` while changing intake to attachment comments.
- **FR-003**: The system MUST support exactly two intake modes: `manual` and `csv_attachment`.
- **FR-004**: The textarea bulk CSV intake used in `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` MUST be superseded for new requests by `csv_attachment`, while preserving semantics and outcomes.
- **FR-005**: The system MUST require exactly one supported intake mode per request.
- **FR-006**: `csv_attachment` requests with valid baseline metadata and no accepted attachment MUST transition to `waiting_for_attachment`.
- **FR-007**: Approval and execution MUST remain blocked while request status is `waiting_for_attachment`.
- **FR-008**: Accepted CSV attachment candidate MUST be from a requester-authored comment on the same issue.
- **FR-009**: For each active attempt, exactly one qualifying attachment candidate MAY be accepted; ambiguous sets MUST fail closed.
- **FR-010**: Attachment candidate selection MUST pick the newest eligible requester attachment comment posted after the latest failed attachment-validation attempt.
- **FR-011**: Attachment validation MUST enforce bounded size limits, UTF-8 decodability, CSV suitability checks, and deterministic content hashing with provenance capture.
- **FR-012**: CSV-content validation MUST preserve `repository` header requirements and all preserved row-level semantics from `specs/009-add-team-repo-access-bulk-csv-mode/spec.md`.
- **FR-013**: The system MUST preserve baseline repo-access scope: one organization, one existing team, one requested built-in permission level (`read`, `triage`, `write`, `maintain`, `admin`) per batch, multiple repositories.
- **FR-014**: The system MUST NOT introduce permission removal, permission downgrades, team lifecycle changes, repository lifecycle changes, branch protections, or other out-of-scope administration actions.
- **FR-015**: Reconciliation MUST grant only missing eligible access, treat exact/stronger existing access as no-op, and reject weaker/conflicting existing states per baseline rules.
- **FR-016**: Dry-run behavior MUST remain non-mutating while still emitting reconciliation and audit evidence.
- **FR-017**: Terminal states MUST include `executed`, `partially_executed`, and `failed_after_approved_execution`.
- **FR-018**: Later CSV attachment comments posted after terminal state MUST be recorded as ignored terminal events and MUST NOT trigger attachment revalidation or candidate reselection.
- **FR-019**: Forbidden transitions from terminal state MUST include transitions back to `waiting_for_attachment`, `validation_failed`, or `awaiting_approval`.
- **FR-020**: The system MUST preserve operation-aware terminal evidence (including labels/status markers and restored artifact signals) so fresh runners enforce terminal ignore behavior deterministically.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from issue submitter identity and used for requester-only attachment acceptance checks.
- **AR-002**: Approval model from `specs/005-add-team-repo-access/spec.md` MUST remain unchanged and fully enforced for manual and attachment intake, including designated-approver approval for the full batch, explicit approval signaling, routing-only central assignment, and target-side approver eligibility validation at approval time.
- **AR-003**: Central issue assignment MUST remain routing-only and MUST NOT count as approval.
- **AR-004**: Approval MUST remain explicit, centrally visible, and validated against current target-side approver eligibility for the full batch.
- **AR-005**: CSV attachment intake MUST NOT introduce per-row approvers or alternative approval paths.
- **AR-006**: Execution MUST continue to use PAT-backed `ISSUEOPS_GITHUB_TOKEN` with least privilege required for validation, approval checks, attachment processing, reconciliation, and mutation.
- **AR-007**: Workflow MUST fail closed when token availability or permissions are insufficient.

### Validation Strategy *(mandatory)*

- **VS-001**: Parse issue payload into structured fields for organization, team, designated approver, intake mode, requested permission, and requested repositories before mutation eligibility.
- **VS-002**: Preserve baseline manual validation behavior from `specs/005-add-team-repo-access/spec.md`.
- **VS-003**: Preserve baseline CSV semantic checks from `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` for header, row shape, duplicates, conflicts, unsupported columns, and row findings.
- **VS-004**: For `csv_attachment`, perform conservative attachment discovery from same-issue comments and linked URLs with requester-only filtering.
- **VS-005**: Reject or ignore non-qualifying attachment comments without advancing lifecycle.
- **VS-006**: Accept only newest eligible requester attachment after latest failed attempt.
- **VS-007**: Emit 1-based data-row numbering excluding header row for all CSV row findings.
- **VS-008**: Validate target-side existence/eligibility for organization, team, and repositories under baseline semantics.
- **VS-009**: Validate permission semantics under baseline rules (exact/stronger no-op, weaker/conflicting reject).
- **VS-010**: Block approval readiness until attachment and CSV-content validation succeed.
- **VS-011**: Ignore later attachment comments once terminal state is detected.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state derivation for attachment-driven requests MUST map to the same requested-repository semantic model as manual and 009 flows.
- **RL-002**: Reconciliation MUST read latest repository/team permission state before mutation.
- **RL-003**: Apply only missing eligible grants.
- **RL-004**: Preserve no-op handling for already-satisfied repositories.
- **RL-005**: Preserve rejection handling for weaker/conflicting existing permissions.
- **RL-006**: Preserve idempotent rerun behavior.
- **RL-007**: Later attachment comments in terminal state MUST NOT re-enter reconciliation.

### Rollback Handling *(mandatory)*

- **RH-001**: Pre-mutation failures (including attachment discovery/download/CSV validation) MUST result in zero-change outcomes.
- **RH-002**: Partial execution failures MUST preserve per-repository outcomes and operator guidance for failed subset retry.
- **RH-003**: Workflow MUST fail closed when authorization, validation, approval, attachment, or reconciliation prerequisites are not met.

### Observability Requirements *(mandatory)*

- **OR-001**: Emit structured evidence for intake mode, waiting-state transitions, attachment acceptance/rejection decisions, approval decisions, reconciliation outcomes, and execution outcomes.
- **OR-002**: Required evidence MUST include requester, approver, organization, team, requested permission, attachment provenance (URL/comment/uploader/filename/hash/timestamp), row-level findings, applied/no-op/rejected/failed repository counts, rollback status, and terminal-state evidence.
- **OR-003**: Human-readable summaries MUST clearly distinguish routing actions from authorization outcomes.
- **OR-004**: Human-readable summaries MUST clearly indicate waiting, validation-blocked, approval-pending, approved, and terminal states.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Minimize API usage by deterministic candidate selection, early duplicate/conflict filtering, and bounded state reads.
- **GH-002**: Use bounded retry and backoff for retryable comment-read, attachment-download, and mutation calls.
- **GH-003**: On non-retryable or exhausted retry conditions, stop mutation safely, preserve partial results, and surface operator retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Verify manual-path non-regression against `specs/005-add-team-repo-access/spec.md`.
- **TE-002**: Verify preserved CSV semantics against `specs/009-add-team-repo-access-bulk-csv-mode/spec.md`.
- **TE-003**: Verify waiting lifecycle and approval blocking for `csv_attachment`.
- **TE-004**: Verify requester-only attachment acceptance.
- **TE-005**: Verify ambiguous and non-qualifying attachment fail-closed behavior.
- **TE-006**: Verify corrected attachment supersession after failed validation.
- **TE-007**: Verify approval continuity and routing-only central assignment behavior.
- **TE-008**: Verify reconciliation, no-op handling, and idempotent reruns for attachment-driven requests.
- **TE-009**: Verify dry-run behavior and non-mutation guarantees.
- **TE-010**: Verify partial-failure outcome reporting and bounded retry/rate-limit behavior.
- **TE-011**: Verify terminal-state immutability and no reopen after terminal execution.

### Key Entities *(include if feature involves data)*

- **Repository Access Request**: Baseline request entity extended with intake mode and waiting lifecycle state.
- **CSV Attachment Submission**: Provenance-tracked requester attachment candidate for one request.
- **CSV Attachment Validation Attempt**: Deterministic attachment-processing cycle capturing acceptance, rejection, supersession, and ignored-terminal outcomes.
- **CSV Row Finding**: Per-row validation record preserving 009 semantics and 1-based data-row numbering excluding header.
- **Repository Grant Reconciliation Result**: Baseline per-repository applied/no-op/rejected/failed outcomes reused unchanged after attachment normalization.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid manual requests remain behaviorally equivalent to `specs/005-add-team-repo-access/spec.md`.
- **SC-002**: At least 95% of syntactically valid requester attachment submissions with valid baseline metadata reach `awaiting_approval` on first valid attempt.
- **SC-003**: 100% of requests in `waiting_for_attachment` remain blocked from approval and mutation.
- **SC-004**: 100% of execution attempts without valid target-side approval remain blocked.
- **SC-005**: 100% of terminal-state requests ignore later attachment comments and do not reopen lifecycle.
- **SC-006**: For completed runs, stakeholders can determine attachment provenance, row outcomes, and final repository grant outcomes without inspecting raw logs.

## Assumptions

- `specs/005-add-team-repo-access/spec.md` remains authoritative for unchanged baseline behavior.
- `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` remains authoritative for preserved CSV semantics and row findings.
- Attachment lifecycle pattern from `specs/010-team-members-csv-attachment/spec.md`, `specs/011-create-org-teams-csv-attachment/spec.md`, and `specs/012-add-child-teams-csv-attachment/spec.md` is reusable with repo-access-specific constraints.
- GitHub issue attachments are discovered operationally through issue/comment-linked URLs.
- One organization, one team, one permission level, and one designated approver remain request-scoped boundaries.
- Least-privilege PAT-backed `ISSUEOPS_GITHUB_TOKEN` remains required for privileged operations unless future work explicitly changes credential model.
