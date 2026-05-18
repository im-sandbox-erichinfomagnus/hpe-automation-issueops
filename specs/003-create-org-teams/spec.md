# Feature Specification: Create Organization Teams Workflow

**Feature Branch**: `003-create-org-teams`  
**Created**: 2026-05-15  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for an IssueOps workflow that creates one or more empty teams in a target GitHub organization. The workflow is hosted in a central administration repository, uses a PAT stored as the `ISSUEOPS_GITHUB_TOKEN` Actions secret, assigns the central issue to a central-repo owner for queue ownership, requires approval in the central repository from a valid target team owner, creates only missing teams, does not add team members, preserves re-run safety, and defers notification optimization and GitHub App migration to later enhancements." 

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Team Creation Requests (Priority: P1)

An authorized requester submits one request in the central administration repository to create one or more empty teams in a specific target GitHub organization, including the intended owner for each requested team, and the workflow validates the request before any mutation is allowed.

**Why this priority**: Without a valid intake and validation path, there is no safe way to request team creation or route it for approval.

**Independent Test**: Can be fully tested by submitting requests for one or more new teams in an existing target organization and verifying that valid requests become approval-ready while invalid, duplicate, or conflicting team definitions are rejected without creating teams.

**Acceptance Scenarios**:

1. **Given** a requester submits a valid target organization and one or more well-formed team definitions that do not already exist, **When** validation completes, **Then** the request is recorded as approval-ready and no team is created yet.
2. **Given** a requester submits malformed, duplicate, or conflicting team definitions, **When** validation completes, **Then** the request is rejected with clear errors and no team is created.
3. **Given** a requester submits a mix of new team definitions and teams that already exist, **When** validation completes, **Then** the workflow marks existing teams as already satisfied, keeps only the missing teams eligible for creation, and preserves a single auditable request record.

---

### User Story 2 - Approve Requests Through the Central Repository (Priority: P2)

A valid target approver reviews the request in the central repository and explicitly approves it there, while the workflow automatically verifies through GitHub data that the approver is authorized for every team requested in the batch.

**Why this priority**: Team creation is a privileged organizational change and must remain approval-gated even when the request is routed centrally.

**Independent Test**: Can be fully tested by submitting a valid multi-team request, assigning the central issue for queue visibility, and verifying that only a single approver who is designated as the intended owner for every requested team can unlock execution.

**Acceptance Scenarios**:

1. **Given** a valid request where one GitHub user is designated as the intended owner for every requested team, **When** that same user approves in the central repository, **Then** the workflow accepts the approval and marks the request eligible for execution.
2. **Given** a valid request where the approving commenter is not the intended owner for every requested team, **When** approval is evaluated, **Then** the workflow rejects the approval and leaves the request blocked.
3. **Given** a request that includes multiple different intended owners across the requested teams, **When** validation completes, **Then** the workflow rejects the batch as not approvable through a single valid approver and instructs the requester to split the request into separately approvable batches.

---

### User Story 3 - Create Only Missing Teams and Report Outcomes (Priority: P3)

After valid approval, the workflow reads the current team state in the target organization, creates only the missing teams, and reports successful, no-op, and failed outcomes with audit-friendly detail.

**Why this priority**: The business value of the workflow comes from safely creating the requested teams while preserving idempotent behavior and operational traceability.

**Independent Test**: Can be fully tested by approving a request that includes new teams, already-existing teams, and a partially failing item, then verifying that only missing teams are created and the outcome clearly distinguishes created, skipped, and failed items.

**Acceptance Scenarios**:

1. **Given** an approved request where none of the requested teams already exist, **When** execution runs, **Then** the workflow creates those teams and records a successful outcome.
2. **Given** an approved request where some requested teams already exist, **When** execution runs, **Then** the workflow creates only the missing teams and records existing teams as no-op outcomes.
3. **Given** an approved request where one or more team creations fail after others succeed, **When** execution finishes, **Then** the workflow records the partial success, identifies which teams failed, and provides operator-facing follow-up guidance.

### Edge Cases

- A request contains duplicate team names or duplicate team slugs in the same submission.
- Two requested teams normalize to conflicting slugs even though their display names differ.
- A requested team already exists in the target organization before approval.
- A requested team is created by another actor after approval but before execution.
- A proposed intended owner is not a valid member of the target organization.
- A request includes multiple teams with different intended owners, making single-approver approval invalid for this version.
- A requester includes team member usernames or membership instructions even though population of team members is handled by a separate IssueOps workflow.
- A requester attempts to submit a parent-team relationship even though parent-team configuration is out of scope for this feature version.
- The approval commenter in the central repository is visible there but is not authorized for the requested teams in the target organization.
- The workflow token is missing, lacks sufficient permission, or cannot see the target organization state.
- GitHub API rate limiting interrupts validation or execution after some requested teams have already been processed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized requester to submit one request to create one or more teams in a specific target GitHub organization.
- **FR-002**: The system MUST capture the target organization and the full list of requested team definitions as part of the request.
- **FR-003**: Each requested team definition MUST include the intended team name and exactly one intended owner who will be accountable for approving and owning that team.
- **FR-003A**: The system MUST treat this feature as an empty-team creation workflow only and MUST NOT accept, model, or process requested team member lists as part of the request.
- **FR-004**: The system MUST validate that at least one team is requested and reject empty submissions.
- **FR-005**: The system MUST validate each requested team name and derived slug for well-formedness before approval or mutation can continue.
- **FR-006**: The system MUST detect duplicate or conflicting team definitions in the same request and reject any request that cannot be normalized safely.
- **FR-007**: The system MUST inspect the target organization to determine which requested teams already exist.
- **FR-008**: The system MUST require explicit approval in the central repository before any team is created.
- **FR-009**: For this feature version, the system MUST accept approval only when a single GitHub user is designated as the intended owner for every requested team in the batch.
- **FR-010**: The system MUST reject multi-team batches that require more than one intended owner to approve them and direct the requester to split those teams into separately approvable requests.
- **FR-011**: The system MUST create only the requested teams that do not already exist in the target organization.
- **FR-012**: The system MUST leave already-existing teams unchanged and record them as no-op outcomes.
- **FR-013**: The system MUST assign the central repository issue to a central-repository owner for queue ownership and operational visibility only.
- **FR-014**: The system MUST NOT treat central issue assignment as evidence that a valid target approver has approved the request.
- **FR-015**: The system MUST produce a clear execution result that distinguishes created teams, already-existing teams, rejected definitions, and failed creations.
- **FR-016**: The system MUST preserve an auditable record of the request, central issue assignment outcome, approval decision, execution outcome, and any partial failure details.
- **FR-017**: Parent-team configuration MUST be out of scope for this feature version, and any parent-team input MUST be rejected with a clear message.
- **FR-018**: Team membership population MUST remain out of scope for this feature version and MUST be handled by a separate IssueOps workflow.
- **FR-019**: Notification improvement, mirrored approval surfaces, and GitHub App migration MUST remain out of scope for this feature version.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST be derived from the GitHub user who submitted the central repository request.
- **AR-002**: The approver identity MUST be derived from the GitHub user who submits the approval signal in the central repository.
- **AR-003**: A valid approver for this feature version MUST be the single intended owner designated on every requested team in the batch.
- **AR-004**: The workflow MUST automatically verify the approver against current GitHub organization data for the target organization before accepting approval.
- **AR-005**: The executing workflow identity MUST use the `ISSUEOPS_GITHUB_TOKEN` secret as the privileged credential for target-state validation, approver verification, and team creation.
- **AR-006**: The workflow MUST request and use only the minimum PAT-backed permissions needed to read target organization state, inspect approver eligibility, create teams, and write central-repository issue updates.
- **AR-007**: The workflow MUST fail closed when the PAT is missing, insufficient, revoked, or otherwise unauthorized for the required validation or mutation steps.
- **AR-008**: The PAT-backed credential model MUST be treated as an initial implementation assumption only and MUST NOT imply that GitHub App support is included in this feature's scope.

### Validation Strategy *(mandatory)*

- **VS-001**: The system MUST parse the request payload into structured fields for target organization and requested team definitions before any mutation step is eligible to run.
- **VS-002**: Preflight validation MUST confirm that the target organization exists and is visible to the workflow identity.
- **VS-003**: Preflight validation MUST confirm that at least one requested team is present and that each team definition is well formed.
- **VS-004**: Preflight validation MUST normalize team names into comparison-safe slugs and reject duplicate or conflicting definitions.
- **VS-005**: Preflight validation MUST determine which requested teams already exist in the target organization.
- **VS-006**: Preflight validation MUST confirm that the intended owner for each requested team is valid in the target organization context.
- **VS-007**: Preflight validation MUST reject any request whose requested teams do not all share the same intended owner for approval purposes.
- **VS-008**: Validation results MUST remain visible in the central repository context before approval is used to authorize execution.
- **VS-009**: Validation MUST reject parent-team input for this feature version as outside the approved scope boundary.
- **VS-010**: Validation MUST reject any team member names, member lists, or membership instructions because this workflow only creates empty teams.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as the target organization containing every valid requested team that does not already exist.
- **RL-002**: The system MUST read current team state from the target organization before applying any requested change.
- **RL-003**: The system MUST compare desired state to current state and create only missing teams.
- **RL-004**: Existing teams MUST be treated as already satisfied and MUST NOT be recreated or modified.
- **RL-005**: Re-running the same approved request MUST converge safely without duplicate team creation or conflicting outcomes.
- **RL-006**: If organization state changes between approval and execution, the system MUST recompute current state from the latest available data before attempting team creation.
- **RL-007**: If only a subset of requested teams can be created successfully, the system MUST preserve a per-team outcome record for created, skipped, and failed items.

### Rollback Handling *(mandatory)*

- **RH-001**: If execution fails before any team is created, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds, the system MUST record which teams were created and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when authorization, validation, approval, or organization-state prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured evidence for request intake, validation outcome, central issue assignment outcome, approval decision, reconciliation decision, and final execution result.
- **OR-002**: Observability outputs MUST include the central issue identifier, workflow run identifier, requester, approver, target organization, requested team count, created team count, no-op team count, and failed team count.
- **OR-003**: The system MUST present a human-readable summary of the final request state in the central repository context.
- **OR-004**: Audit outputs MUST clearly distinguish central operational routing from target-side approval authorization.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by validating target organization and existing team state once per execution attempt where possible.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify valid and invalid request parsing for single-team and multi-team submissions.
- **TE-002**: Tests MUST verify rejection of duplicate, conflicting, and malformed team definitions.
- **TE-003**: Tests MUST verify that intended owners are validated against the target organization context.
- **TE-004**: Tests MUST verify approval validation in the central repository using target approver identity checks.
- **TE-005**: Tests MUST verify rejection of multi-team batches that require more than one approving owner.
- **TE-006**: Tests MUST verify reconciliation behavior for all-new teams, mixed existing-and-new teams, and fully satisfied no-op reruns.
- **TE-007**: Tests MUST verify rejection of any request that includes team member names or membership instructions.
- **TE-008**: Tests MUST verify partial failure reporting, audit output, and bounded rate-limit handling behavior.

### Key Entities *(include if feature involves data)*

- **Team Creation Request**: A request record containing the requester, target organization, requested team definitions, validation outcome, central routing state, approval state, and execution outcome.
- **Requested Team Definition**: A single requested team entry containing the intended team name, normalized slug, intended owner, and per-team validation or execution result.
- **Approval Decision**: A record of who approved or denied the request, how that identity was verified against the target organization, and whether the full request batch was approvable by that single user.
- **Team Creation Result**: A per-team outcome record indicating whether the team was created, already existed, was rejected before execution, or failed during execution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of valid requests for non-existing teams reach an approval-ready state without manual correction on the first submission.
- **SC-002**: 100% of execution attempts without a valid target approver approval are blocked from creating teams.
- **SC-003**: 100% of repeated executions for already-satisfied team requests complete without duplicate team creation.
- **SC-004**: For completed runs, requesters and approvers can determine from the recorded outcome which teams were created, skipped, rejected, or failed without inspecting raw system internals.
- **SC-005**: The workflow preserves the central repository as the single authoritative audit surface for request, approval, and execution state.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository's standard central IssueOps intake flow.
- The target organization's current GitHub state remains the authoritative source for whether a team already exists and whether an intended owner is valid.
- For this feature version, a request batch is only considered approvable when all requested teams share the same intended owner.
- This workflow creates empty teams only; adding members to those teams will be handled by a separate IssueOps workflow.
- Central issue assignment is a queue-management aid only, and any later optimization of notification to the target approver is outside the scope of this feature.
- The `ISSUEOPS_GITHUB_TOKEN` secret is available to the workflow and has sufficient permission to validate organization state, verify approver eligibility, and create teams.
- Migration from the PAT-backed credential model to a GitHub App is explicitly deferred to a later enhancement.