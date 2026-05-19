# Feature Specification: Add Team Repository Access Workflow

**Feature Branch**: `005-add-team-repo-access`  
**Created**: 2026-05-18  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for an IssueOps workflow hosted in the central administration repository that adds one existing GitHub team to one or more existing repositories in a target GitHub organization.

The workflow must follow the same repository conventions as the existing IssueOps features: central issue-form intake, thin GitHub workflow shim under .github/workflows, shared implementation under src, tests under tests, and structured audit artifacts. It must use the PAT-backed Actions secret named ISSUEOPS_GITHUB_TOKEN as the privileged credential for target-organization validation, repository and team visibility checks, approver verification, and repository team-permission mutation.

Scope this feature only to repository access assignment for an existing team. The workflow must accept exactly one existing target team, one target organization, one or more existing repositories in that same organization, and one requested repository permission level for the full batch. For this feature version, supported requested permission levels are limited to the built-in repository roles `read`, `triage`, `write`, `maintain`, and `admin`. Custom repository roles are out of scope for this feature version and must be treated as a future enhancement. The workflow must not create or delete repositories, must not create or delete teams, must not add or remove team members, must not manage branch protections, must not change repository settings, and must not remove team access. For this feature version, permission removal or downgrades are out of scope.

The workflow must reconcile current GitHub state before mutation. If the team does not currently have access to a requested repository, the workflow should grant the requested permission. If the team already has the exact requested permission on a repository, the workflow must record a no-op result for that repository. If the team already has a stronger permission than requested, the workflow must treat that repository as already satisfied and must not downgrade it. If the team already has a different weaker permission and satisfying the request would require modifying an existing repository-team permission, the workflow must reject that repository for this feature version rather than silently changing existing access. The workflow must reconcile only missing access grants and remain safe to rerun.

Keep the approval model explicit and unambiguous in the specification. Central issue assignment in the hosting repository must remain routing-only and must not count as approval. Approval must occur in the central repository from a valid target-side approver for the full request batch, and if the request would require multiple different approvers the workflow must reject the batch and tell the requester to split it. For this feature version, define the valid approver as one designated active target organization owner for the full request batch, and require the specification to define exactly how that identity is verified. The workflow must automatically verify that the designated approver is currently an active owner in the target organization before accepting approval.

The specification must include explicit sections and requirements for authorization, validation, reconciliation, rollback or compensating actions, observability, testing expectations, and GitHub API rate-limit handling. It must define durable audit outputs that record requester, approver, target organization, target team, requested repositories, requested permission level, central issue assignment outcome, approval outcome, reconciliation plan, mutation results, no-op results, rejected items, failed items, and rollback status.

Include acceptance scenarios, edge cases, and measurable success criteria. Edge cases must cover at least:
- missing target organization
- missing target team
- missing repository
- duplicate repository entries in the same request
- mixed-organization inputs
- repository archived or otherwise not eligible for access changes
- team already assigned to the repository with the exact requested permission
- team already assigned with a stronger permission
- team already assigned with a weaker or conflicting permission
- invalid or unauthorized approver
- request batch requiring multiple different approvers
- missing or insufficient ISSUEOPS_GITHUB_TOKEN permissions
- dry-run behavior
- partial failure after some grants succeed
- bounded retry behavior under GitHub API rate limiting
- stale state where repository access changes between approval and execution

Keep notification optimization, mirrored approval surfaces, GitHub App migration, repository creation, team creation, team membership management, permission removal, permission downgrades, and broader repository administration out of scope unless explicitly required.

The resulting specification should match the tone and structure of the existing repository specs, including:
- prioritized independently testable user stories
- acceptance scenarios written in Given/When/Then form
- explicit functional requirements
- explicit authorization requirements
- explicit validation strategy
- explicit reconciliation logic
- explicit rollback handling
- explicit observability requirements
- explicit GitHub API rate-limit handling
- explicit testing expectations
- key entities
- measurable success criteria
- assumptions"

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Team Access Requests (Priority: P1)

An authorized requester submits one request in the central administration repository to grant one existing team a specific permission level on one or more existing repositories in a target GitHub organization, and the workflow validates the full batch before any mutation is allowed.

**Why this priority**: Without a safe intake and validation path, there is no reliable way to request repository access changes or route them for review.

**Independent Test**: Can be fully tested by submitting requests for an existing team and one or more existing repositories in the same organization and verifying that valid requests become approval-ready while missing resources, duplicate repository entries, archived repositories, or conflicting access state are rejected without changing repository permissions.

**Acceptance Scenarios**:

1. **Given** a requester submits a valid target organization, one existing team, one or more existing repositories in that organization, and one allowed permission level, **When** validation completes, **Then** the request is recorded as approval-ready and no repository permission mutation is attempted.
2. **Given** a requester submits a request with a missing team, a missing repository, duplicate repository entries, or repositories outside the target organization, **When** validation completes, **Then** the workflow rejects the request with clear errors and no repository access is changed.
3. **Given** a requester submits a request where some repositories already satisfy the desired permission state and others do not, **When** validation completes, **Then** the workflow records already-satisfied repositories as no-op items, keeps only eligible missing grants available for execution, and preserves one auditable request record.

---

### User Story 2 - Approve Access Grants Through the Central Repository (Priority: P2)

A designated active target organization owner reviews the request in the central repository and explicitly approves it there, while the workflow verifies through current GitHub organization state that the approver is currently an owner in the target organization for the full batch.

**Why this priority**: Repository access changes affect who can interact with code and must remain approval-gated even when intake and routing happen centrally.

**Independent Test**: Can be fully tested by submitting a valid request, assigning the central issue for queue visibility, and verifying that only one designated active target organization owner can unlock execution while invalid or missing approvals leave the request blocked.

**Acceptance Scenarios**:

1. **Given** a valid request where one GitHub user is designated as the access approver for the full batch and is currently an active owner in the target organization, **When** that same user approves in the central repository, **Then** the workflow accepts the approval and marks the request eligible for execution.
2. **Given** a valid request where the approving commenter is not the designated approver or is not currently an active owner in the target organization, **When** approval is evaluated, **Then** the workflow rejects the approval and leaves the request blocked.
3. **Given** a request where the requested repository grants would require multiple different valid approvers, **When** validation completes, **Then** the workflow rejects the batch as not approvable through a single valid approver and instructs the requester to split it into separately approvable requests.

---

### User Story 3 - Grant Only Missing Repository Access and Report Outcomes (Priority: P3)

After valid approval, the workflow reads the current repository access state in the target organization, grants only the missing repository permissions for the target team, and reports successful, no-op, rejected, and failed outcomes with audit-friendly detail.

**Why this priority**: The business value of the workflow comes from safely reconciling requested repository access while preserving idempotent reruns and operational traceability.

**Independent Test**: Can be fully tested by approving a request that includes repositories with no current team access, repositories already satisfying the requested permission, repositories with stronger existing permission, and a partially failing item, then verifying that only missing eligible grants are applied and the outcome clearly distinguishes applied, skipped, rejected, and failed items.

**Acceptance Scenarios**:

1. **Given** an approved request where the team has no access to any requested repository, **When** execution runs, **Then** the workflow grants the requested permission on those repositories and records a successful outcome.
2. **Given** an approved request where some repositories already give the team the exact requested permission or a stronger permission, **When** execution runs, **Then** the workflow changes only the missing eligible grants and records the already-satisfied repositories as no-op outcomes.
3. **Given** an approved request where one or more repository access grants fail after others succeed, **When** execution finishes, **Then** the workflow records the partial success, identifies which repositories failed, and provides operator-facing follow-up guidance.

### Edge Cases

- The target organization does not exist or is not visible to the workflow identity.
- The requested team does not exist in the target organization.
- One or more requested repositories do not exist in the target organization.
- The request contains duplicate repository names or duplicate normalized repository identifiers.
- The request attempts to mix repositories or teams from different organizations in one batch.
- A requested repository is archived or otherwise not eligible for access mutation in this feature version.
- The team already has the exact requested permission on a repository before approval.
- The team already has a stronger permission than requested on a repository.
- The team already has a weaker or conflicting permission on a repository that would require modifying existing access rather than granting new access.
- The approval commenter is visible in the central repository but is not currently an active owner in the target organization.
- The request would require more than one valid approver across the requested repository grants.
- The workflow token is missing, lacks sufficient permission, or cannot see the target organization, repository, or team access state.
- Dry-run is requested and the workflow must stop before mutation while still emitting reviewable reconciliation output.
- GitHub API throttling interrupts validation or execution after some repository grants have already been processed.
- Repository access state changes between approval and execution, including a repository being archived or access being granted by another actor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized requester to submit one request to grant one existing team a single requested permission level on one or more existing repositories in a specific target GitHub organization.
- **FR-002**: The system MUST capture the target organization, the requested team, the full list of requested repositories, one requested permission level for the full batch, and one designated access approver as part of the request.
- **FR-003**: The system MUST treat this feature as a repository access grant workflow only and MUST NOT create or delete repositories, create or delete teams, add or remove team members, remove team access, downgrade permissions, change repository settings, or manage branch protections.
- **FR-004**: The system MUST validate that exactly one team, at least one repository, and exactly one requested permission level are provided and reject empty or incomplete submissions.
- **FR-004a**: For this feature version, the system MUST accept only the built-in repository roles `read`, `triage`, `write`, `maintain`, and `admin` as requested permission levels and MUST reject custom repository roles as out of scope.
- **FR-005**: The system MUST validate the team identifier and each repository identifier for well-formedness before approval or mutation can continue.
- **FR-006**: The system MUST detect duplicate or conflicting repository definitions in the same request and reject any request that cannot be normalized safely.
- **FR-007**: The system MUST inspect the target organization to determine whether the requested team exists and whether each requested repository exists and is eligible for access changes.
- **FR-008**: The system MUST inspect the current team permission state for each requested repository to determine whether the requested permission is missing, already satisfied, stronger than requested, or conflicting with this feature version.
- **FR-009**: The system MUST require explicit approval in the central repository before any repository permission mutation is attempted.
- **FR-010**: For this feature version, the system MUST accept approval only when a single GitHub user is designated as the access approver for the full request batch and that user is currently an active owner in the target organization.
- **FR-011**: The system MUST reject request batches that require more than one valid approver and direct the requester to split them into separately approvable requests.
- **FR-012**: The system MUST grant only the requested repository permissions that are missing for the target team.
- **FR-013**: The system MUST leave repositories unchanged and record them as no-op outcomes when the team already has the exact requested permission or a stronger permission.
- **FR-014**: The system MUST reject repositories whose current team permission is weaker or otherwise conflicting when satisfying the request would require modifying existing access rather than granting missing access.
- **FR-015**: The system MUST assign the central repository issue to a central-repository owner for queue ownership and operational visibility only.
- **FR-016**: The system MUST NOT treat central issue assignment as evidence that a valid target approver has approved the request.
- **FR-017**: The system MUST produce a clear execution result that distinguishes applied repository grants, already-satisfied repositories, rejected repositories, and failed repositories.
- **FR-018**: The system MUST preserve an auditable record of the request, central issue assignment outcome, approval decision, reconciliation outcome, execution outcome, and any partial failure details.
- **FR-019**: Notification improvement, mirrored approval surfaces, GitHub App migration, repository creation, team creation, team membership management, broader repository administration, permission removal, and permission downgrades MUST remain out of scope for this feature version.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST be derived from the GitHub user who submitted the central repository request.
- **AR-002**: The approver identity MUST be derived from the GitHub user who submits the approval signal in the central repository.
- **AR-003**: A valid approver for this feature version MUST be the single designated active owner of the target organization for the full request batch.
- **AR-004**: The workflow MUST automatically verify that the designated access approver is currently an active owner in the target organization before accepting approval.
- **AR-005**: The executing workflow identity MUST use the `ISSUEOPS_GITHUB_TOKEN` secret as the privileged credential for target-state validation, approver verification, and repository team-permission mutation.
- **AR-006**: The workflow MUST request and use only the minimum PAT-backed permissions needed to read target organization, repository, and team state, inspect approver eligibility, grant team access to repositories, and write central-repository issue updates.
- **AR-007**: The workflow MUST fail closed when the PAT is missing, insufficient, revoked, or otherwise unauthorized for the required validation or mutation steps.
- **AR-008**: The PAT-backed credential model MUST be treated as an initial implementation assumption only and MUST NOT imply that GitHub App support is included in this feature's scope.

### Validation Strategy *(mandatory)*

- **VS-001**: The system MUST parse the request payload into structured fields for target organization, requested team, requested repositories, requested permission level, and designated access approver before any mutation step is eligible to run.
- **VS-001a**: Preflight validation MUST confirm that the requested permission level normalizes to one of the supported built-in repository roles and reject custom repository roles for this feature version.
- **VS-002**: Preflight validation MUST confirm that the target organization exists and is visible to the workflow identity.
- **VS-003**: Preflight validation MUST confirm that the requested team exists in the target organization.
- **VS-004**: Preflight validation MUST confirm that each requested repository exists in the same target organization as the requested team and is eligible for access mutation.
- **VS-005**: Preflight validation MUST normalize repository identifiers into comparison-safe values and reject duplicate or conflicting repository definitions.
- **VS-006**: Preflight validation MUST determine whether each requested repository currently has no team access, the exact requested permission, a stronger permission, or a conflicting weaker permission.
- **VS-007**: Preflight validation MUST confirm that the designated access approver is currently an active owner in the target organization.
- **VS-008**: Preflight validation MUST reject any request whose requested repository grants do not all share the same valid access approver for approval purposes.
- **VS-009**: Validation MUST reject archived repositories and any repositories that are otherwise not eligible for access changes in this feature version.
- **VS-010**: Validation MUST reject any repository whose current team permission would require modifying or downgrading existing access rather than granting missing access.
- **VS-011**: Validation MUST reject any out-of-scope repository-administration, branch-protection, team-creation, team-membership, permission-removal, or permission-downgrade input.
- **VS-012**: Validation results MUST remain visible in the central repository context before approval is used to authorize execution.
- **VS-013**: Validation MUST support dry-run evaluation that shows the reconciliation plan without mutating repository access.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as the target team having at least the requested permission level on every valid requested repository in the target organization.
- **RL-002**: The system MUST read current repository-team permission state from the target organization before applying any requested change.
- **RL-003**: The system MUST compare desired state to current state and grant only missing eligible repository access.
- **RL-004**: Repositories where the team already has the exact requested permission or a stronger permission MUST be treated as no-op results and MUST NOT be rewritten.
- **RL-005**: Re-running the same approved request MUST converge safely without duplicate grants or conflicting outcomes.
- **RL-006**: If repository access state changes between approval and execution, the system MUST recompute current state from the latest available data before attempting mutation.
- **RL-007**: If only a subset of requested repository grants can be applied successfully, the system MUST preserve a per-repository outcome record for applied, skipped, rejected, and failed items.

### Rollback Handling *(mandatory)*

- **RH-001**: If execution fails before any repository access mutation is applied, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds, the system MUST record which repository grants were applied and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when authorization, validation, approval, or repository-state prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured evidence for request intake, validation outcome, central issue assignment outcome, approval decision, reconciliation decision, and final execution result.
- **OR-002**: Observability outputs MUST include the central issue identifier, workflow run identifier, requester, approver, target organization, target team, requested repository count, requested permission level, applied grant count, no-op count, rejected count, failed count, and rollback status.
- **OR-003**: The system MUST present a human-readable summary of the final request state in the central repository context.
- **OR-004**: Audit outputs MUST clearly distinguish central operational routing from target-side approval authorization.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by reading target organization, repository, team, and permission state once per execution attempt where possible.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify valid and invalid request parsing for one-team multi-repository submissions, including acceptance of supported built-in repository roles and rejection of unsupported custom roles.
- **TE-002**: Tests MUST verify rejection of duplicate, conflicting, missing, archived, and malformed repository references.
- **TE-003**: Tests MUST verify that designated access approvers are validated as active owners in the target organization at approval time.
- **TE-004**: Tests MUST verify approval validation in the central repository using target approver identity checks.
- **TE-005**: Tests MUST verify rejection of request batches that require more than one valid approver.
- **TE-006**: Tests MUST verify reconciliation behavior for all-new repository grants, mixed already-satisfied and missing grants, stronger-permission no-op results, and fully satisfied no-op reruns.
- **TE-007**: Tests MUST verify rejection of weaker-permission conflicts, permission downgrades, permission removals, and other out-of-scope repository-administration changes.
- **TE-008**: Tests MUST verify partial failure reporting, dry-run behavior, audit output, and bounded rate-limit handling behavior.

### Key Entities *(include if feature involves data)*

- **Repository Access Request**: A request record containing the requester, target organization, target team, requested repositories, requested permission level, validation outcome, central routing state, approval state, and execution outcome.
- **Requested Repository Grant**: A single requested repository-team permission entry containing the repository identifier, current permission state, desired action, and per-repository validation or execution result.
- **Access Approval Decision**: A record of who approved or denied the request, how that identity was verified as an active owner in the target organization, and whether the full request batch was approvable by that single user.
- **Repository Access Mutation Result**: A per-repository outcome record indicating whether the team was granted access, already satisfied the requested permission, was rejected before execution, or failed during execution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of valid repository access requests for existing teams and repositories reach an approval-ready state without manual correction on the first submission.
- **SC-002**: 100% of execution attempts without a valid target-side approval are blocked from mutating repository access.
- **SC-003**: 100% of repeated executions for already-satisfied repository access requests complete without duplicate repository grants or permission downgrades.
- **SC-004**: For completed runs, requesters and approvers can determine from the recorded outcome which repositories were granted access, skipped as already satisfied, rejected, or failed without inspecting raw system internals.
- **SC-005**: The workflow preserves the central repository as the single authoritative audit surface for request, approval, and repository access execution state.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository's standard central IssueOps intake flow.
- The target organization's current GitHub state remains the authoritative source for whether the requested team and repositories exist, whether repositories are eligible for access changes, whether the designated approver is currently an active owner in the target organization, and whether requested repository access is already satisfied.
- For this feature version, a request batch is only considered approvable when all requested repository grants share the same valid access approver.
- For this feature version, satisfying the request means granting missing access only; permission downgrades, permission removal, custom repository roles, and changes that would require modifying weaker existing access are rejected rather than applied.
- Support for custom repository roles is explicitly deferred to a future enhancement.
- Central issue assignment is a queue-management aid only, and any later optimization of notification to the target approver is outside the scope of this feature.
- The `ISSUEOPS_GITHUB_TOKEN` secret is available to the workflow and has sufficient permission to validate organization state, verify approver eligibility, inspect current team repository permissions, and apply approved repository access grants.
- Migration from the PAT-backed credential model to a GitHub App is explicitly deferred to a later enhancement.
