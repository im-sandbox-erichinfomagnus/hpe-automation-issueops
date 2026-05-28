# Feature Specification: Cost Center Reallocation Workflow

**Feature Branch**: `015-cost-center-reallocation`  
**Created**: 2026-05-28  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for an IssueOps workflow that lets an operator create enterprise cost centers and add or remove user resources from them, driven by a pasted CSV. The workflow is hosted in a central administration repository, uses a PAT stored as the `ISSUEOPS_GITHUB_TOKEN` Actions secret with enterprise billing access, requires approval in the central repository from a named intended approver, creates only missing cost centers, adds or removes only the user resources needed to reconcile the request, defaults to dry-run because the enterprise billing token is the known blocker, degrades gracefully when live billing state cannot be read, and defers organization and repository resource types plus GitHub App migration to later enhancements."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Cost Center Reallocation Requests (Priority: P1)

An authorized operator submits one request in the central administration repository that names a target enterprise and pastes a CSV of cost center assignments, and the workflow validates the request before any mutation is allowed.

**Why this priority**: Without a valid intake and validation path, there is no safe way to request cost center changes or route them for approval.

**Independent Test**: Can be fully tested by submitting a request with a pasted assignments CSV against an enterprise and verifying that valid requests become approval-ready while malformed CSV rows, unknown actions, or empty submissions are rejected without mutating any cost center.

**Acceptance Scenarios**:

1. **Given** an operator submits a valid enterprise slug and a well-formed assignments CSV, **When** validation completes, **Then** the request is recorded as approval-ready and no cost center is created or changed yet.
2. **Given** an operator submits a CSV with malformed rows, an unknown action, or a missing required column, **When** validation completes, **Then** the request is rejected with clear errors and no cost center is created or changed.
3. **Given** an operator submits a request while no enterprise billing token is available, **When** validation completes, **Then** the workflow runs structural CSV checks, marks live cost center state as unverified, and keeps the request eligible for a dry-run plan only.

---

### User Story 2 - Approve Requests Through the Central Repository (Priority: P2)

The named intended approver reviews the request in the central repository and explicitly approves it there, while the workflow verifies that the approving commenter matches the intended approver named on the request.

**Why this priority**: Cost center reallocation changes enterprise billing attribution and must remain approval-gated even when the request is routed centrally.

**Independent Test**: Can be fully tested by submitting a valid request that names an intended approver and verifying that only an exact `approved` comment from that named approver unlocks execution.

**Acceptance Scenarios**:

1. **Given** a valid request that names an intended approver, **When** that same login comments exactly `approved` in the central repository, **Then** the workflow accepts the approval and marks the request eligible for execution.
2. **Given** a valid request where the approving commenter is not the named intended approver, **When** approval is evaluated, **Then** the workflow rejects the approval and leaves the request blocked.
3. **Given** a valid request whose approval comment is not exactly `approved`, **When** approval is evaluated, **Then** the workflow does not treat the comment as an approval signal and the request stays blocked.

---

### User Story 3 - Reconcile Cost Centers and Report Outcomes (Priority: P3)

After valid approval and only when the request is not a dry run, the workflow reads current cost center state in the enterprise, creates only the missing cost centers, adds or removes only the user resources needed, and reports created, added, removed, no-op, and failed outcomes with audit-friendly detail.

**Why this priority**: The business value of the workflow comes from safely reconciling cost center membership while preserving idempotent behavior and operational traceability.

**Independent Test**: Can be fully tested by approving a request that includes new cost centers, existing cost centers, add rows, remove rows, and a partially failing item, then verifying that only required changes are applied and the outcome clearly distinguishes created, added, removed, skipped, and failed items.

**Acceptance Scenarios**:

1. **Given** an approved non-dry-run request whose cost centers do not all exist, **When** execution runs, **Then** the workflow creates the missing cost centers and records a successful outcome.
2. **Given** an approved non-dry-run request with add rows for users already in a cost center and remove rows for users not in it, **When** execution runs, **Then** the workflow applies only the required changes and records the already-satisfied rows as no-op outcomes.
3. **Given** an approved request submitted as a dry run, **When** the workflow runs, **Then** it reports the planned creations, additions, and removals without mutating any cost center.

### Edge Cases

- A pasted CSV contains a malformed header or omits the required `cost_center`, `login`, or `action` column.
- A CSV row uses an action other than `add` or `remove`, or leaves the action blank where the default applies.
- The same user resource appears in both an add row and a remove row for the same cost center in one submission.
- Duplicate rows request the same cost center, login, and action more than once.
- A requested cost center already exists in the enterprise before approval.
- A cost center is created or deleted by another actor after approval but before execution.
- A remove row targets a user resource that is not currently assigned to the named cost center.
- The request includes organization or repository resource lines even though this version handles user resources only.
- The enterprise billing token is missing, so live cost center existence and membership cannot be verified and live state must be marked unverified.
- The workflow token is present but lacks enterprise billing or admin access for the required reconciliation steps.
- GitHub API rate limiting interrupts validation or execution after some rows have already been processed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized operator to submit one request to create cost centers and add or remove user resources in a specific target enterprise.
- **FR-002**: The system MUST capture the target enterprise slug, the named intended approver, the pasted assignments CSV, a business justification, and a dry-run selection as part of the request.
- **FR-003**: The assignments CSV MUST use the header `cost_center,login,action`, where `action` is `add` or `remove` and defaults to `add` when omitted.
- **FR-003A**: The system MUST treat this feature as a user-resource workflow only and MUST NOT accept, model, or process organization or repository resource assignments as part of the request.
- **FR-004**: The system MUST validate that at least one well-formed assignment row is present and reject empty submissions.
- **FR-005**: The system MUST validate each CSV row for a non-empty cost center name, a non-empty login, and a recognized action before approval or mutation can continue.
- **FR-006**: The system MUST detect duplicate or conflicting assignment rows in the same request and reject any request that cannot be normalized safely.
- **FR-007**: The system MUST inspect the enterprise to determine which requested cost centers already exist when an enterprise billing token is available.
- **FR-008**: The system MUST require explicit approval in the central repository before any cost center is created or changed.
- **FR-009**: For this feature version, the system MUST accept approval only when the approving commenter matches the single named intended approver on the request.
- **FR-010**: The system MUST treat an approval comment as valid only when its body is exactly `approved` from the named intended approver.
- **FR-011**: The system MUST create only the requested cost centers that do not already exist in the enterprise.
- **FR-012**: The system MUST add or remove only the user resources needed to reconcile each cost center and record already-satisfied rows as no-op outcomes.
- **FR-013**: The system MUST default to dry-run because the enterprise billing token is the known blocker, and dry-run requests MUST report planned changes without mutating any cost center.
- **FR-014**: The system MUST degrade gracefully when the enterprise billing token is unavailable by running structural CSV checks and marking live cost center state as unverified.
- **FR-015**: The system MUST produce a clear execution result that distinguishes created cost centers, added resources, removed resources, no-op rows, rejected rows, and failed operations.
- **FR-016**: The system MUST preserve an auditable record of the request, approval decision, execution outcome, live-state verification status, and any partial failure details.
- **FR-017**: Organization and repository resource types MUST be out of scope for this feature version, and any such input MUST be rejected with a clear message.
- **FR-018**: Cost center deletion MUST remain out of scope for this feature version; the workflow creates cost centers and adds or removes user resources only.
- **FR-019**: Notification improvement, mirrored approval surfaces, and GitHub App migration MUST remain out of scope for this feature version.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST be derived from the GitHub user who submitted the central repository request.
- **AR-002**: The approver identity MUST be derived from the GitHub user who submits the approval signal in the central repository.
- **AR-003**: A valid approver for this feature version MUST be the single named intended approver recorded on the request.
- **AR-004**: The workflow MUST verify that the approving commenter login matches the named intended approver before accepting approval.
- **AR-005**: The executing workflow identity MUST use the `ISSUEOPS_GITHUB_TOKEN` secret as the privileged credential for cost center state reads, creation, and user-resource changes.
- **AR-006**: The workflow MUST request and use only the minimum PAT-backed permissions needed to read enterprise cost center state, create cost centers, change user resources, and write central-repository issue updates.
- **AR-007**: The workflow MUST fail closed when the PAT is missing, insufficient, revoked, or otherwise unauthorized for the required mutation steps, while still allowing a structural dry-run when live state cannot be read.
- **AR-008**: The PAT-backed credential model MUST be treated as an initial implementation assumption only and MUST NOT imply that GitHub App support is included in this feature's scope.

### Validation Strategy *(mandatory)*

- **VS-001**: The system MUST parse the request payload into structured fields for enterprise, intended approver, assignment rows, and dry-run selection before any mutation step is eligible to run.
- **VS-002**: Preflight validation MUST confirm that the enterprise slug is present and well formed.
- **VS-003**: Preflight validation MUST confirm that the assignments CSV header matches `cost_center,login,action` and that at least one well-formed row is present.
- **VS-004**: Preflight validation MUST normalize assignment rows, apply the default `add` action, and reject duplicate or conflicting rows.
- **VS-005**: Preflight validation MUST determine which requested cost centers already exist in the enterprise when an enterprise billing token is available.
- **VS-006**: Preflight validation MUST mark live cost center existence and membership as unverified when the enterprise billing token is unavailable rather than failing the request.
- **VS-007**: Preflight validation MUST reject any request whose approval cannot be tied to the single named intended approver.
- **VS-008**: Validation results MUST remain visible in the central repository context before approval is used to authorize execution.
- **VS-009**: Validation MUST reject organization and repository resource input for this feature version as outside the approved scope boundary.
- **VS-010**: Validation MUST reject any action value other than `add` or `remove` after default application.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as the enterprise containing every requested cost center and each cost center holding the user resources implied by its add and remove rows.
- **RL-002**: The system MUST read current cost center and membership state from the enterprise before applying any requested change when live state is available.
- **RL-003**: The system MUST compare desired state to current state and create only missing cost centers and apply only required user-resource changes.
- **RL-004**: Already-satisfied rows MUST be treated as no-op and MUST NOT be reapplied.
- **RL-005**: Re-running the same approved request MUST converge safely without duplicate cost center creation or redundant membership changes.
- **RL-006**: If enterprise state changes between approval and execution, the system MUST recompute current state from the latest available data before attempting mutation.
- **RL-007**: If only a subset of requested changes can be applied successfully, the system MUST preserve a per-row outcome record for created, added, removed, skipped, and failed items.

### Rollback Handling *(mandatory)*

- **RH-001**: If execution fails before any change is applied, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds, the system MUST record which changes were applied and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when authorization, validation, approval, or enterprise-state prerequisites for mutation are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured evidence for request intake, validation outcome, live-state verification status, approval decision, reconciliation decision, and final execution result.
- **OR-002**: Observability outputs MUST include the central issue identifier, workflow run identifier, requester, approver, enterprise, requested cost center count, created count, added count, removed count, no-op count, and failed count.
- **OR-003**: The system MUST present a human-readable summary of the final request state in the central repository context.
- **OR-004**: Audit outputs MUST clearly distinguish dry-run plans from applied mutations and clearly mark when live cost center state was unverified.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by reading enterprise cost center state once per execution attempt where possible.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify valid and invalid CSV parsing for single-row and multi-row submissions, including default action application.
- **TE-002**: Tests MUST verify rejection of duplicate, conflicting, and malformed assignment rows and unknown actions.
- **TE-003**: Tests MUST verify the degraded path that marks live cost center state unverified when no enterprise billing token is available.
- **TE-004**: Tests MUST verify approval validation in the central repository using the named intended approver and the exact `approved` comment convention.
- **TE-005**: Tests MUST verify rejection of organization and repository resource input.
- **TE-006**: Tests MUST verify reconciliation behavior for all-new cost centers, mixed existing-and-new cost centers, add and remove rows, and fully satisfied no-op reruns.
- **TE-007**: Tests MUST verify that dry-run requests report planned changes without mutating any cost center.
- **TE-008**: Tests MUST verify partial failure reporting, audit output, and bounded rate-limit handling behavior.

### Key Entities *(include if feature involves data)*

- **Cost Center Reallocation Request**: A request record containing the requester, enterprise, intended approver, parsed assignment rows, dry-run selection, validation outcome, live-state verification status, approval state, and execution outcome.
- **Assignment Row**: A single normalized CSV entry containing the cost center name, target login, resolved action, and per-row validation or execution result.
- **Approval Decision**: A record of who approved or denied the request, how that identity was matched against the named intended approver, and whether the request was approvable.
- **Reallocation Result**: A per-row outcome record indicating whether a cost center was created, a user resource was added or removed, the row was already satisfied, the row was rejected before execution, or it failed during execution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of valid requests reach an approval-ready state without manual correction on the first submission.
- **SC-002**: 100% of execution attempts without a valid named-approver approval are blocked from creating or changing cost centers.
- **SC-003**: 100% of repeated executions for already-satisfied requests complete without duplicate cost center creation or redundant membership changes.
- **SC-004**: For completed runs, requesters and approvers can determine from the recorded outcome which cost centers were created and which user resources were added, removed, skipped, rejected, or failed without inspecting raw system internals.
- **SC-005**: The workflow preserves the central repository as the single authoritative audit surface for request, approval, and execution state.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository's standard central IssueOps intake flow.
- The enterprise's current GitHub billing state remains the authoritative source for whether a cost center exists and which user resources it holds.
- For this feature version, a request is only approvable when the approving commenter matches the single named intended approver.
- This workflow handles user resources only; organization and repository resource types are deferred to a later enhancement.
- The default is dry-run because the enterprise billing token is the known blocker, and live mutation requires that token to be present and sufficiently privileged.
- The `ISSUEOPS_GITHUB_TOKEN` secret, when available, has enterprise billing or admin access sufficient to read cost center state, create cost centers, and change user resources.
- Migration from the PAT-backed credential model to a GitHub App is explicitly deferred to a later enhancement.
