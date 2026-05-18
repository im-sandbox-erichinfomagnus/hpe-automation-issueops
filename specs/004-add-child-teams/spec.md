# Feature Specification: Add Child Teams Workflow

**Feature Branch**: `004-add-child-teams`  
**Created**: 2026-05-15  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for an IssueOps workflow hosted in the central administration repository that adds one or more existing teams as child teams under one existing parent team in a target GitHub organization.

The workflow must follow the same repository conventions as the existing IssueOps features: central issue-form intake, thin GitHub workflow shim, shared implementation under src, tests under tests, and structured audit artifacts. It must use the PAT-backed Actions secret named ISSUEOPS_GITHUB_TOKEN as the privileged credential for target-organization validation, approver verification, and hierarchy mutation.

Scope this feature only to team hierarchy management. It must be able to link one or more existing child teams to one existing parent team in the same target organization. It must not create or delete teams, must not add or remove team members, must not grant repositories, and must not change team settings other than the requested parent-child relationship. If a requested child team is already attached to the requested parent, the workflow must record a no-op result. If the current state differs, the workflow must reconcile only the missing parent-child links and remain safe to rerun.

Keep the approval model explicit and unambiguous in the spec. Central issue assignment in the hosting repository must remain routing-only and must not count as approval. Approval must occur in the central repository from a valid target-side approver for the full request batch, and if the request would require multiple different approvers the workflow must reject the batch and tell the requester to split it. The specification must clearly define who that valid approver is for this use case and how that identity is verified against current GitHub organization state.

The specification must include explicit sections and requirements for authorization, validation, reconciliation, rollback or compensating actions, observability, and GitHub API rate-limit handling. It must define durable audit outputs that record requester, approver, target organization, parent team, requested child teams, assignment outcome, approval outcome, reconciliation plan, mutation results, and rollback status.

Include acceptance scenarios, edge cases, and measurable success criteria. Edge cases must cover at least: missing target organization, missing parent team, missing child team, duplicate child teams in the same request, child team already linked to the requested parent, child team currently linked to a different parent, attempted hierarchy cycles, invalid or unauthorized approver, mixed-organization inputs, missing or insufficient ISSUEOPS_GITHUB_TOKEN permissions, dry-run behavior, partial failure, and bounded retry behavior under rate limiting.

Keep notification optimization, mirrored approval surfaces, GitHub App migration, member-management, team creation, and repository-permission changes out of scope unless explicitly required."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Team Hierarchy Requests (Priority: P1)

An authorized requester submits one request in the central administration repository to attach one or more existing child teams under one existing parent team in a specific target GitHub organization, and the workflow validates the hierarchy change before any mutation is allowed.

**Why this priority**: Without a safe intake and validation path, there is no reliable way to request team hierarchy changes or expose them for review.

**Independent Test**: Can be fully tested by submitting requests for an existing parent team and one or more existing child teams in the same target organization and verifying that valid requests become approval-ready while missing teams, duplicate child teams, conflicting hierarchy state, or out-of-scope inputs are rejected without changing team relationships.

**Acceptance Scenarios**:

1. **Given** a requester submits a valid target organization, one existing parent team, and one or more existing child teams that are not yet attached to that parent, **When** validation completes, **Then** the request is recorded as approval-ready and no team hierarchy mutation is attempted.
2. **Given** a requester submits a request with a missing parent team, a missing child team, or duplicate child teams, **When** validation completes, **Then** the workflow rejects the request with clear errors and no team hierarchy mutation is attempted.
3. **Given** a requester submits a request where some child teams are already attached to the requested parent and others are not, **When** validation completes, **Then** the workflow records already-attached child teams as satisfied, keeps only the missing parent-child links eligible for execution, and preserves one auditable request record.

---

### User Story 2 - Approve Hierarchy Changes Through the Central Repository (Priority: P2)

A valid target-side hierarchy approver reviews the request in the central repository and explicitly approves it there, while the workflow verifies through current GitHub organization and team-maintainer state that the approver is authorized for the full request batch.

**Why this priority**: Team hierarchy changes affect organizational delegation and must remain approval-gated even when intake and routing happen centrally.

**Independent Test**: Can be fully tested by submitting a valid hierarchy request, assigning the central issue for queue visibility, and verifying that only the single designated hierarchy approver for the full batch can unlock execution while invalid or missing approvals leave the request blocked.

**Acceptance Scenarios**:

1. **Given** a valid request where one GitHub user is designated as the hierarchy approver for the full batch and is an active maintainer of the requested parent team and every requested child team, **When** that same user approves in the central repository, **Then** the workflow accepts the approval and marks the request eligible for execution.
2. **Given** a valid request where the approving commenter is not the designated hierarchy approver or is not currently authorized on the affected target teams, **When** approval is evaluated, **Then** the workflow rejects the approval and leaves the request blocked.
3. **Given** a request where the requested parent-child links would require more than one valid hierarchy approver, **When** validation completes, **Then** the workflow rejects the batch as not approvable through a single valid approver and instructs the requester to split it into separately approvable requests.

---

### User Story 3 - Attach Only Missing Child Links and Report Outcomes (Priority: P3)

After valid approval, the workflow reads the current team hierarchy in the target organization, adds only the missing parent-child links, and reports successful, no-op, rejected, and failed outcomes with audit-friendly detail.

**Why this priority**: The business value of the workflow comes from safely reconciling requested hierarchy changes while preserving no-op reruns and operational traceability.

**Independent Test**: Can be fully tested by approving a request that includes child teams already attached to the parent, child teams not yet attached, and a partially failing item, then verifying that only missing hierarchy links are applied and the outcome clearly distinguishes applied, skipped, rejected, and failed items.

**Acceptance Scenarios**:

1. **Given** an approved request where none of the requested child teams are attached to the requested parent, **When** execution runs, **Then** the workflow adds those child teams under the parent and records a successful outcome.
2. **Given** an approved request where some requested child teams are already attached to the requested parent, **When** execution runs, **Then** the workflow changes only the missing parent-child links and records already-satisfied child teams as no-op outcomes.
3. **Given** an approved request where one or more hierarchy mutations fail after others succeed, **When** execution finishes, **Then** the workflow records the partial success, identifies which child-team links failed, and provides operator-facing follow-up guidance.

### Edge Cases

- The target organization does not exist or is not visible to the workflow identity.
- The requested parent team does not exist in the target organization.
- One or more requested child teams do not exist in the target organization.
- The request contains duplicate child-team names or duplicate normalized child-team identifiers.
- A requested child team is already attached to the requested parent before approval.
- A requested child team is attached to a different parent when the request is validated.
- A requested hierarchy change would create a cycle in the team tree.
- The approval commenter is visible in the central repository but is not authorized for the requested hierarchy change in the target organization.
- The request would require more than one valid hierarchy approver across the requested child-team links.
- The request attempts to mix teams from different organizations in one batch.
- The request includes out-of-scope member-management, repository-permission, team-creation, or team-deletion instructions.
- The workflow token is missing, lacks sufficient permission, or cannot see the target organization and team hierarchy state.
- Dry-run is requested and the workflow must stop before mutation while still emitting reviewable reconciliation output.
- GitHub API throttling interrupts validation or execution after some requested child-team links have already been processed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized requester to submit one request to attach one or more existing child teams under one existing parent team in a specific target GitHub organization.
- **FR-002**: The system MUST capture the target organization, the requested parent team, the full list of requested child teams, and one designated hierarchy approver as part of the request.
- **FR-003**: The system MUST treat this feature as a team-hierarchy workflow only and MUST NOT create or delete teams, add or remove team members, grant repositories, or change team settings other than the requested parent-child relationship.
- **FR-004**: The system MUST validate that exactly one parent team and at least one child team are requested and reject empty or incomplete submissions.
- **FR-005**: The system MUST validate the parent team identifier and each child-team identifier for well-formedness before approval or mutation can continue.
- **FR-006**: The system MUST detect duplicate or conflicting child-team definitions in the same request and reject any request that cannot be normalized safely.
- **FR-007**: The system MUST inspect the target organization to determine whether the requested parent team exists and whether each requested child team exists.
- **FR-008**: The system MUST inspect the current team hierarchy to determine which requested child teams are already attached to the requested parent.
- **FR-009**: The system MUST require explicit approval in the central repository before any team hierarchy mutation is attempted.
- **FR-010**: For this feature version, the system MUST accept approval only when a single GitHub user is designated as the hierarchy approver for every requested parent-child link in the batch.
- **FR-011**: The system MUST reject request batches that require more than one valid hierarchy approver and direct the requester to split them into separately approvable requests.
- **FR-012**: The system MUST add only the requested child teams that are not already attached to the requested parent team.
- **FR-013**: The system MUST leave already-attached child teams unchanged and record them as no-op outcomes.
- **FR-014**: The system MUST reject child teams that are currently attached to a different parent team for this feature version rather than silently re-parent them.
- **FR-015**: The system MUST reject hierarchy mutations that would create a cycle in the target team tree.
- **FR-016**: The system MUST assign the central repository issue to a central-repository owner for queue ownership and operational visibility only.
- **FR-017**: The system MUST NOT treat central issue assignment as evidence that a valid target approver has approved the request.
- **FR-018**: The system MUST produce a clear execution result that distinguishes applied hierarchy links, already-satisfied links, rejected links, and failed links.
- **FR-019**: The system MUST preserve an auditable record of the request, central issue assignment outcome, approval decision, reconciliation outcome, execution outcome, and any partial failure details.
- **FR-020**: Notification improvement, mirrored approval surfaces, GitHub App migration, member-management, team creation, team deletion, and repository-permission changes MUST remain out of scope for this feature version.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST be derived from the GitHub user who submitted the central repository request.
- **AR-002**: The approver identity MUST be derived from the GitHub user who submits the approval signal in the central repository.
- **AR-003**: A valid approver for this feature version MUST be the single hierarchy approver designated for the full request batch.
- **AR-004**: The workflow MUST automatically verify the designated hierarchy approver against current GitHub organization and team-maintainer state for the requested parent team and every requested child team before accepting approval.
- **AR-005**: The executing workflow identity MUST use the `ISSUEOPS_GITHUB_TOKEN` secret as the privileged credential for target-state validation, approver verification, and hierarchy mutation.
- **AR-006**: The workflow MUST request and use only the minimum PAT-backed permissions needed to read target organization and team state, inspect approver eligibility, update team hierarchy, and write central-repository issue updates.
- **AR-007**: The workflow MUST fail closed when the PAT is missing, insufficient, revoked, or otherwise unauthorized for the required validation or mutation steps.
- **AR-008**: The PAT-backed credential model MUST be treated as an initial implementation assumption only and MUST NOT imply that GitHub App support is included in this feature's scope.

### Validation Strategy *(mandatory)*

- **VS-001**: The system MUST parse the request payload into structured fields for target organization, requested parent team, requested child teams, and designated hierarchy approver before any mutation step is eligible to run.
- **VS-002**: Preflight validation MUST confirm that the target organization exists and is visible to the workflow identity.
- **VS-003**: Preflight validation MUST confirm that the requested parent team exists in the target organization.
- **VS-004**: Preflight validation MUST confirm that each requested child team exists in the same target organization as the requested parent team.
- **VS-005**: Preflight validation MUST normalize child-team identifiers into comparison-safe values and reject duplicate or conflicting child-team definitions.
- **VS-006**: Preflight validation MUST determine which requested child teams are already attached to the requested parent and which are not.
- **VS-007**: Preflight validation MUST confirm that the designated hierarchy approver is valid for the target organization context and the requested parent-child links.
- **VS-008**: Preflight validation MUST reject any request whose requested parent-child links do not all share the same valid hierarchy approver for approval purposes.
- **VS-009**: Validation MUST reject any request that would require re-parenting a child team from a different current parent for this feature version.
- **VS-010**: Validation MUST reject any request that would create a hierarchy cycle.
- **VS-011**: Validation MUST reject any out-of-scope team-creation, team-deletion, membership, repository-permission, or notification-management input.
- **VS-012**: Validation results MUST remain visible in the central repository context before approval is used to authorize execution.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as the target parent team having every valid requested child team attached beneath it.
- **RL-002**: The system MUST read current parent-team and child-team hierarchy state from the target organization before applying any requested change.
- **RL-003**: The system MUST compare desired state to current state and add only missing parent-child links.
- **RL-004**: Already-satisfied parent-child links MUST be treated as no-op results and MUST NOT be rewritten.
- **RL-005**: Re-running the same approved request MUST converge safely without duplicate hierarchy mutations or conflicting outcomes.
- **RL-006**: If hierarchy state changes between approval and execution, the system MUST recompute current state from the latest available data before attempting mutation.
- **RL-007**: If only a subset of requested hierarchy links can be applied successfully, the system MUST preserve a per-link outcome record for applied, skipped, rejected, and failed items.

### Rollback Handling *(mandatory)*

- **RH-001**: If execution fails before any hierarchy mutation is applied, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds, the system MUST record which parent-child links were applied and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when authorization, validation, approval, or hierarchy-state prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured evidence for request intake, validation outcome, central issue assignment outcome, approval decision, reconciliation decision, and final execution result.
- **OR-002**: Observability outputs MUST include the central issue identifier, workflow run identifier, requester, approver, target organization, parent team, requested child-team count, applied-link count, no-op count, failed count, and rollback status.
- **OR-003**: The system MUST present a human-readable summary of the final request state in the central repository context.
- **OR-004**: Audit outputs MUST clearly distinguish central operational routing from target-side approval authorization.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by reading target organization, team, and hierarchy state once per execution attempt where possible.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify valid and invalid request parsing for parent-team and multi-child-team submissions.
- **TE-002**: Tests MUST verify rejection of duplicate, conflicting, missing, and malformed team references.
- **TE-003**: Tests MUST verify that designated hierarchy approvers are validated against current organization and team-maintainer state.
- **TE-004**: Tests MUST verify approval validation in the central repository using target approver identity checks.
- **TE-005**: Tests MUST verify rejection of request batches that require more than one approving owner.
- **TE-006**: Tests MUST verify reconciliation behavior for all-new hierarchy links, mixed already-linked and missing links, and fully satisfied no-op reruns.
- **TE-007**: Tests MUST verify rejection of re-parenting attempts, cycle-creating requests, and other out-of-scope hierarchy changes.
- **TE-008**: Tests MUST verify partial failure reporting, audit output, dry-run behavior, and bounded rate-limit handling behavior.

### Key Entities *(include if feature involves data)*

- **Team Hierarchy Request**: A request record containing the requester, target organization, requested parent team, requested child teams, validation outcome, central routing state, approval state, and execution outcome.
- **Requested Child Link**: A single requested parent-child relationship entry containing the child team identifier, current hierarchy state, desired action, and per-link validation or execution result.
- **Hierarchy Approval Decision**: A record of who approved or denied the request, how that identity was verified against the target organization and affected teams, and whether the full request batch was approvable by that single user.
- **Hierarchy Mutation Result**: A per-link outcome record indicating whether the child team was linked to the parent, was already linked, was rejected before execution, or failed during execution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of valid hierarchy requests for existing parent and child teams reach an approval-ready state without manual correction on the first submission.
- **SC-002**: 100% of execution attempts without a valid target-side approval are blocked from mutating team hierarchy.
- **SC-003**: 100% of repeated executions for already-satisfied hierarchy requests complete without duplicate parent-child links.
- **SC-004**: For completed runs, requesters and approvers can determine from the recorded outcome which child-team links were applied, skipped, rejected, or failed without inspecting raw system internals.
- **SC-005**: The workflow preserves the central repository as the single authoritative audit surface for request, approval, and hierarchy execution state.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository's standard central IssueOps intake flow.
- The target organization's current GitHub state remains the authoritative source for whether the requested parent and child teams exist, whether a child team is already attached to the requested parent, and whether the designated hierarchy approver is currently authorized.
- For this feature version, a request batch is only considered approvable when all requested parent-child links share the same valid hierarchy approver.
- For this feature version, child teams that are currently attached to a different parent are rejected rather than automatically re-parented.
- Central issue assignment is a queue-management aid only, and any later optimization of notification to the target approver is outside the scope of this feature.
- The `ISSUEOPS_GITHUB_TOKEN` secret is available to the workflow and has sufficient permission to validate organization state, verify approver eligibility, inspect team hierarchy, and apply approved parent-child mutations.
- Migration from the PAT-backed credential model to a GitHub App is explicitly deferred to a later enhancement.
