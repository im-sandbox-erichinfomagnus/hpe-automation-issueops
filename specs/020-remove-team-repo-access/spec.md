# Feature Specification: Remove Team Repository Access Workflow

**Feature Branch**: `020-remove-team-repo-access`  
**Created**: 2026-06-02  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for removing one existing GitHub team from one or more existing repositories in a target GitHub organization while preserving IssueOps governance and csv attachment semantics from specs 005, 009, and 013."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Existing Safe Intake and Governance (Priority: P1)

A requester submits a remove-access request in the central administration repository using the same governance model as add-team-repo-access workflows, including explicit approval and routing-only assignment.

**Why this priority**: Access removal is privileged and potentially disruptive. Governance and non-regression guarantees are the highest-priority outcomes.

**Independent Test**: Can be fully tested by submitting valid and invalid removal requests and verifying that intake validation, assignment behavior, approval gating, and blocked-state handling remain consistent with baseline governance semantics.

**Acceptance Scenarios**:

1. **Given** a valid request with one organization, one existing team, one or more repositories, and one designated approver, **When** validation completes, **Then** the request becomes approval-ready without mutating repository access.
2. **Given** a request with missing required fields, duplicate or conflicting repository entries, or mixed-organization repository inputs, **When** validation completes, **Then** the request is rejected with clear validation messages and zero mutation.
3. **Given** a request that is assigned to a central repository owner for queue visibility, **When** assignment completes, **Then** the request remains unapproved until explicit authorized approval is provided.

---

### User Story 2 - Remove Access Through Manual and CSV Attachment Intake (Priority: P2)

A requester can remove team access by using either manual repository input or `csv_attachment` intake, where csv attachment behavior follows the waiting/candidate/validation lifecycle established by repo-access attachment workflows.

**Why this priority**: Operational teams need high-volume, reliable removal workflows while preserving deterministic and auditable intake semantics.

**Independent Test**: Can be fully tested by creating one manual removal request and one csv attachment request, validating waiting and candidate-selection behavior, and confirming both normalize to the same repository-removal model.

**Acceptance Scenarios**:

1. **Given** intake mode `manual` with valid repository list input, **When** validation runs, **Then** repositories are normalized and evaluated for removal readiness using baseline policy checks.
2. **Given** intake mode `csv_attachment` and no qualifying requester attachment comment yet, **When** validation runs, **Then** request status becomes `waiting_for_attachment`, and approval/execution remain blocked.
3. **Given** a `csv_attachment` request with ambiguous, oversized, undecodable, malformed, or unsupported CSV attachment data, **When** validation runs, **Then** the request remains blocked and surfaces row-level findings and actionable errors.
4. **Given** a failed attachment-validation attempt and a newer eligible requester CSV attachment comment, **When** validation reruns, **Then** the newest eligible requester attachment after the latest failure is selected and processed.

---

### User Story 3 - Execute Safe Removal with Idempotent Reconciliation (Priority: P3)

After valid approval, execution removes access only where team access currently exists, records no-op outcomes where access is already absent, preserves partial-failure reporting, and prevents lifecycle reopening after terminal state.

**Why this priority**: The business value is safe removal execution with deterministic outcomes and auditability.

**Independent Test**: Can be fully tested by approving a mixed-state request (some repositories have access, some do not), executing once, rerunning for idempotency, and posting a later attachment comment to verify terminal-state immutability.

**Acceptance Scenarios**:

1. **Given** an approved request where the team currently has access to some requested repositories, **When** execution runs, **Then** access is removed from those repositories and outcomes are recorded per repository.
2. **Given** an approved request where the team has no explicit access to some requested repositories, **When** execution runs, **Then** those repositories are recorded as no-op already satisfied and are not mutated.
3. **Given** execution reaches `executed`, `partially_executed`, or `failed_after_approved_execution`, **When** later attachment comments are posted, **Then** request lifecycle does not transition back to pre-execution states.

### Edge Cases

- Target organization missing, not visible, or inaccessible.
- Target team missing or not visible in target organization.
- Requested repository missing, archived, or ineligible for team-permission mutation.
- Duplicate repository entries or conflicting normalized repository identifiers.
- Mixed-organization repository inputs in one batch.
- Request requires multiple different approvers.
- Approver is missing, unauthorized, or no longer an active owner at approval time.
- `ISSUEOPS_GITHUB_TOKEN` missing, revoked, or insufficient for required reads/writes.
- `csv_attachment` request has no candidate attachment.
- `csv_attachment` candidate set is ambiguous.
- Attachment exceeds size cap, fails UTF-8 decoding, or fails CSV schema/content checks.
- State drifts between approval and execution (access already removed or changed externally).
- Partial execution failure after some removals succeed.
- Rate-limit exhaustion during validation or execution.
- Later attachment comments posted after terminal state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support removing one existing team from one or more existing repositories in one target GitHub organization.
- **FR-002**: System MUST preserve central IssueOps operating model from add-team-repo-access baselines: central intake, thin workflow shim, shared Node support modules, and auditable artifacts.
- **FR-003**: System MUST support exactly two intake modes: `manual` and `csv_attachment`.
- **FR-004**: System MUST require exactly one intake mode per request and reject ambiguous intake.
- **FR-005**: For `csv_attachment` mode, system MUST transition to `waiting_for_attachment` when baseline metadata is valid but no accepted candidate exists.
- **FR-006**: System MUST block approval and execution while status is `waiting_for_attachment`.
- **FR-007**: System MUST accept only requester-authored same-issue CSV attachment candidates for `csv_attachment` requests.
- **FR-008**: System MUST select the newest eligible requester attachment comment posted after the latest failed attachment-validation attempt.
- **FR-009**: System MUST reject ambiguous attachment candidate sets and fail closed.
- **FR-010**: System MUST preserve CSV schema and row-finding semantics from bulk-csv baseline: required `repository` column, unsupported-column rejection, row-level diagnostics, and 1-based data-row numbering excluding header.
- **FR-011**: System MUST normalize repository identifiers into a comparison-safe model before approval readiness.
- **FR-012**: System MUST reconcile against latest GitHub state before mutation.
- **FR-013**: If team currently has access to a requested repository, desired action MUST be `remove_access`.
- **FR-014**: If team currently has no explicit access to a requested repository, desired action MUST be `noop` (already satisfied).
- **FR-015**: System MUST be idempotent on reruns and MUST avoid duplicate mutation attempts for already-removed access.
- **FR-016**: System MUST preserve dry-run behavior as non-mutating while exposing reconciliation decisions.
- **FR-017**: System MUST preserve terminal-state immutability for attachment-driven requests and MUST ignore later attachment comments after terminal state.
- **FR-018**: System MUST NOT create/delete repositories, create/delete teams, add/remove team members, alter branch protections, or modify unrelated repository settings.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from issue submitter identity in central repository context.
- **AR-002**: Approval MUST be explicit in central repository context and MUST NOT be inferred from issue assignment.
- **AR-003**: Designated approver MUST be validated as an active target-side organization owner before approval is accepted.
- **AR-004**: If one request batch requires multiple distinct valid approvers, system MUST reject the batch and require split requests.
- **AR-005**: Workflow MUST use `ISSUEOPS_GITHUB_TOKEN` for privileged validation and mutation operations.
- **AR-006**: Credential usage MUST follow least privilege and fail closed when token is unavailable or insufficient.

### Validation Strategy *(mandatory)*

- **VS-001**: Parse request payload into organization, team, repositories, intake mode, and designated approver before any mutation eligibility.
- **VS-002**: Validate organization/team/repository existence and eligibility against current GitHub state.
- **VS-003**: Enforce duplicate/conflict rejection for normalized repository identifiers.
- **VS-004**: For `csv_attachment`, enforce requester-only candidate selection, deterministic candidate resolution, bounded size, UTF-8 decodability, and CSV schema validation.
- **VS-005**: Emit row-level findings with stable row numbering and explicit failure reasons for CSV failures.
- **VS-006**: Validate approval eligibility and approver identity under designated-approver model before execution.
- **VS-007**: Include explicit error taxonomy and human-readable messages for required failure classes.
- **VS-008**: Preserve and report deterministic validation outcomes before approval can proceed.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired removal state is: target team has no explicit repository access on each requested repository.
- **RL-002**: Reconciliation MUST read current team-permission state per requested repository before execution.
- **RL-003**: Reconciliation MUST classify each repository as `remove_access`, `noop_already_absent`, `reject`, or `failed`.
- **RL-004**: Execution MUST mutate only repositories classified as `remove_access`.
- **RL-005**: Reruns MUST recompute state and remain idempotent.
- **RL-006**: On stale-state drift, reconciliation MUST use latest state and record drift-aware outcomes.

### Rollback Handling *(mandatory)*

- **RH-001**: Pre-mutation failures MUST result in zero-change outcomes.
- **RH-002**: Partial execution failures MUST preserve per-repository success/failure outcomes and remediation guidance.
- **RH-003**: Workflow MUST fail closed when authorization, validation, approval, or reconciliation prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: Emit structured logs/artifacts for intake, assignment, approval, reconciliation, execution, and terminal-state decisions.
- **OR-002**: Artifact fields MUST include requester, approver, organization, team, intake mode, attachment provenance (if any), requested repositories, reconciliation plan, applied removals, no-ops, rejected items, failed items, rollback/remediation status.
- **OR-003**: Provide central repository human-readable summary that distinguishes routing actions from authorization and execution outcomes.
- **OR-004**: Preserve row-level CSV failure details in user-facing and audit outputs for attachment mode.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Use bounded retry/backoff only for retryable throttling/transient errors.
- **GH-002**: Stop mutation safely when retry budget is exhausted and preserve partial outcomes.
- **GH-003**: Surface operator-actionable retry guidance when execution cannot complete due to rate limiting.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests for manual non-regression against add-team-repo-access governance and reconciliation semantics.
- **TE-002**: Tests for `csv_attachment` waiting lifecycle and approval blocking.
- **TE-003**: Tests for requester-only candidate selection and ambiguous-candidate fail-closed behavior.
- **TE-004**: Tests for correction flow (newest eligible requester attachment after latest failed attempt).
- **TE-005**: Tests for repository normalization, duplicate/conflict rejection, and row-level CSV findings.
- **TE-006**: Tests for approval-gate and unauthorized approver rejection.
- **TE-007**: Tests for removal reconciliation correctness (`remove_access`, `noop_already_absent`, idempotent rerun).
- **TE-008**: Tests for dry-run no-mutation guarantees.
- **TE-009**: Tests for partial failures, durable outcome reporting, and remediation guidance.
- **TE-010**: Tests for terminal-state immutability after execution.
- **TE-011**: Tests for bounded retry and rate-limit behavior.

### Key Entities *(include if feature involves data)*

- **TeamRepoAccessRemovalRequest**: Parsed and normalized request representing one organization, one team, one or more repositories, one approver, and selected intake mode.
- **CsvAttachmentSubmission**: Provenance-tracked candidate/accepted attachment metadata and validation-attempt state for attachment mode.
- **RequestedRepositoryRemoval**: Per-repository normalized intent and reconciliation/execution status for removal.
- **ApprovalDecision**: Approval status and approver eligibility evidence for full request batch.
- **RemovalExecutionOutcome**: Durable per-run summary including removal/no-op/reject/failure counts and remediation state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests without valid approval remain blocked from mutation.
- **SC-002**: 100% of `csv_attachment` requests without accepted valid attachment remain blocked from approval/execution.
- **SC-003**: 100% of reruns for already-removed repositories complete without duplicate removals.
- **SC-004**: For completed runs, reviewers can determine per-repository outcomes (removed, no-op, rejected, failed) from artifacts and summaries without reading raw logs.
- **SC-005**: 100% of terminal-state requests ignore later attachment comments and do not reopen pre-execution lifecycle states.

## Assumptions

- `specs/005-add-team-repo-access/spec.md` remains authoritative baseline for governance and reconciliation framework.
- `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` remains authoritative baseline for CSV schema and row-finding semantics.
- `specs/013-add-team-repo-access-csv-attachment/spec.md` remains authoritative baseline for attachment lifecycle, supersession, and terminal-state immutability semantics.
- Repository access removal uses the same central repository approval/routing model as add-access workflows.
- `ISSUEOPS_GITHUB_TOKEN` remains available for required target-state reads and approved mutation operations.
- Out-of-scope administration actions remain explicitly rejected in this feature version.
