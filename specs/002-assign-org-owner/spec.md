# Feature Specification: Assign Org Owner to Request Issue

**Feature Branch**: `002-assign-org-owner`  
**Created**: 2026-05-15  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for an enhancement to the existing add-team-members IssueOps workflow. Use specs/001-add-team-members/spec.md as the baseline behavior and constraints. Preserve all implemented behavior from spec 001 with no regression in request parsing, validation, approval gating, reconciliation, auditability, idempotency, partial-failure handling, and rate-limit handling. Add issue assignment so that, as soon as a valid add-team-members request workflow is triggered, the GitHub issue is assigned to an eligible organization owner who is assignable on the repository. Exclude the requester from selection if they are also an org owner. Use a deterministic selection rule, avoid unnecessary reassignment, correct ineligible assignees, and fail closed for assignment when no eligible assignable org owner exists without weakening the existing approval rule." 

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Route Approval-Ready Requests to an Eligible Owner (Priority: P1)

When a valid add-team-members request reaches the approval-ready state, the workflow assigns the request issue to one eligible organization owner so the approver receives normal GitHub issue notifications and can act on the request promptly.

**Why this priority**: The enhancement exists to improve approval routing without changing the existing safety model. If issue assignment does not happen, the main user value of the enhancement is missing.

**Independent Test**: Can be fully tested by submitting a valid request for an existing team in an organization that has at least one eligible assignable org owner and verifying that the issue becomes assigned while the request remains in the same approval-gated, no-mutation state defined by spec 001.

**Acceptance Scenarios**:

1. **Given** a valid request for an existing team and at least one eligible assignable org owner, **When** validation completes, **Then** the issue is assigned to exactly one eligible org owner and the request remains awaiting approval.
2. **Given** a valid request where the requester is also an org owner, **When** assignee selection runs, **Then** the requester is excluded and another eligible org owner is chosen if one exists.

---

### User Story 2 - Keep Assignment Stable and Correct (Priority: P2)

The workflow preserves an already-correct assignment, avoids unnecessary reassignment on repeated runs, and corrects assignment only when the current assignee is not eligible to approve the request.

**Why this priority**: Stable assignment avoids notification churn and keeps repeated workflow runs from creating confusing issue activity.

**Independent Test**: Can be fully tested by replaying the workflow on issues that are already assigned to an eligible owner, assigned to an ineligible user, and eligible for multiple owners, then verifying that reassignment happens only when required by policy.

**Acceptance Scenarios**:

1. **Given** a valid request issue that is already assigned to an eligible org owner, **When** the workflow runs again, **Then** the existing assignment is preserved and no reassignment occurs.
2. **Given** a valid request issue that is assigned to an ineligible user, **When** the workflow runs, **Then** the issue assignment is corrected to one eligible org owner selected by the defined deterministic rule.
3. **Given** multiple eligible org owners, **When** selection runs on repeated workflow executions against the same issue state, **Then** the same owner is chosen each time unless eligibility changes.

---

### User Story 3 - Preserve Safety When No Eligible Assignee Exists (Priority: P3)

If the workflow cannot find an eligible assignable org owner, it records the failure clearly without weakening the approval requirement or allowing early mutation.

**Why this priority**: Approval routing is helpful, but the existing privileged-administration safeguards remain more important than notification convenience.

**Independent Test**: Can be fully tested by submitting a valid request in a repository state where no organization owner is assignable to the issue and verifying that the request remains non-mutating, the assignment failure is auditable, and later execution still requires a valid org-owner approval.

**Acceptance Scenarios**:

1. **Given** a valid request and no eligible assignable org owner, **When** assignment is attempted, **Then** the workflow records that assignment could not be completed, leaves the request in a no-mutation approval-pending state, and does not treat assignment failure as approval.
2. **Given** a request that failed issue assignment earlier, **When** a non-owner attempts to approve it, **Then** the request remains blocked exactly as it would under spec 001.

### Edge Cases

- The only organization owner who is assignable to the repository is also the requester.
- An issue is already assigned to a repository collaborator who is not an organization owner.
- Multiple eligible organization owners exist and one later loses assignable repository access between validation and a rerun.
- A valid request becomes assigned correctly, then the issue is manually reassigned before the next workflow event.
- No organization owner is assignable on the repository even though valid organization owners exist in the target organization.
- The request is invalid, so assignment must not imply that the request is approval-ready.
- A workflow rerun occurs after approval, and the assignment logic must not alter the approved execution semantics from spec 001.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST preserve the baseline behavior defined in `001-add-team-members` for request parsing, validation, approval gating, reconciliation, auditability, idempotency, partial-failure handling, and rate-limit handling.
- **FR-002**: The system MUST evaluate issue assignment for each valid add-team-members request that reaches the approval-ready state.
- **FR-003**: The system MUST assign the issue to exactly one eligible organization owner when at least one eligible owner is available.
- **FR-004**: The system MUST exclude the requester from assignee selection when the requester is also an organization owner.
- **FR-005**: The system MUST treat an existing assignment to an eligible organization owner as already satisfied and MUST NOT reassign the issue unnecessarily.
- **FR-006**: The system MUST correct an issue assignment when the current assignee is not an eligible organization owner for the request.
- **FR-007**: The system MUST use a deterministic assignee selection rule whenever more than one eligible organization owner is available.
- **FR-008**: The system MUST define the deterministic selection rule as choosing the lexicographically smallest eligible owner login unless an explicit future rotation policy is introduced.
- **FR-009**: The system MUST record a distinct assignment outcome of assigned, already_satisfied, corrected, or assignment_failed for each valid request evaluation.
- **FR-010**: The system MUST allow a valid request to remain awaiting approval even if issue assignment fails, provided all existing validation requirements from spec 001 are satisfied.
- **FR-011**: The system MUST NOT treat issue assignment as equivalent to approval and MUST NOT allow assignment success or failure to bypass the existing org-owner approval requirement.
- **FR-012**: The system MUST leave invalid requests outside the assignment flow and MUST NOT use issue assignment to imply that validation succeeded.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST continue to be derived from the GitHub user who submitted the request, consistent with spec 001.
- **AR-002**: An eligible assignee MUST be both an organization owner for the target organization and assignable to issues in the repository that hosts the workflow.
- **AR-003**: The executing workflow identity MUST have only the minimum permissions needed to inspect current issue assignees, determine eligible owners, and update issue assignment.
- **AR-004**: The assignment step MUST NOT broaden who may approve the request; only an organization owner may still approve execution.
- **AR-005**: Assignment eligibility MUST be based on the assignee's current organization role, repository assignability, and active account state at the time of assignment evaluation.

### Validation Strategy *(mandatory)*

- **VS-001**: The system MUST determine assignment only after the request has been parsed and confirmed as valid under the existing validation rules from spec 001.
- **VS-002**: Assignment validation MUST confirm that each candidate assignee is an organization owner for the target organization.
- **VS-003**: Assignment validation MUST confirm that each candidate assignee is assignable on the repository that hosts the workflow.
- **VS-004**: Assignment validation MUST exclude the requester from the eligible candidate set.
- **VS-005**: Assignment validation MUST inspect the current issue assignee state so the workflow can distinguish already_satisfied from corrected outcomes.
- **VS-006**: If no eligible assignee exists, the validation result for the request itself MAY remain approval-ready, but the assignment outcome MUST be recorded as failed with a clear reason.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired assignment state MUST be defined as the request issue having exactly one eligible organization-owner assignee selected by the deterministic policy.
- **RL-002**: The system MUST compare the current issue assignee state to the desired assignment state before making any assignment change.
- **RL-003**: If the desired eligible owner is already assigned, the system MUST perform no assignment mutation.
- **RL-004**: If the issue has no assignee or only ineligible assignees, the system MUST reconcile the issue to the desired eligible assignee.
- **RL-005**: Re-running the same valid request with unchanged eligibility inputs MUST converge without assignment churn.
- **RL-006**: Assignment reconciliation MUST remain independent of team membership reconciliation so that no assignment outcome changes the mutation semantics from spec 001.

### Rollback Handling *(mandatory)*

- **RH-001**: If assignment cannot be completed before any assignment change occurs, the system MUST record a zero-change assignment failure result.
- **RH-002**: If assignment changes successfully and later stages fail, the system MUST preserve the assignment audit record rather than hide the successful routing action.
- **RH-003**: The system MUST fail closed for assignment authorization or eligibility errors and MUST NOT continue as though an eligible owner was assigned.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured evidence showing the candidate-owner evaluation, deterministic selection result, prior issue assignee state, assignment action taken, and final assignee state.
- **OR-002**: Observability outputs MUST include the issue identifier, requester, target organization, target team, selected assignee, assignment outcome, and assignment-failure reason when applicable.
- **OR-003**: The human-readable workflow summary MUST state whether the issue was newly assigned, already correctly assigned, corrected, or could not be assigned.
- **OR-004**: Assignment observability MUST make clear that request approval remains pending until an organization owner explicitly approves under the existing rule from spec 001.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary issue-assignment API calls by reading current assignment state before attempting any update.
- **GH-002**: The system MUST treat assignment retries with the same bounded retry discipline already defined for the workflow's broader GitHub API interactions.
- **GH-003**: If rate limiting prevents safe completion of assignment, the system MUST record assignment as incomplete, avoid repeated thrashing, and preserve the existing no-mutation approval-pending workflow state.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify assignment of a valid, unassigned request issue to an eligible organization owner.
- **TE-002**: Tests MUST verify that the requester is excluded from selection when the requester is also an organization owner.
- **TE-003**: Tests MUST verify that an existing eligible org-owner assignee is preserved without reassignment.
- **TE-004**: Tests MUST verify that an ineligible assignee is corrected to the deterministic eligible owner.
- **TE-005**: Tests MUST verify the no-eligible-owner path, including auditable assignment failure and preservation of the approval-gated no-mutation model.
- **TE-006**: Tests MUST verify deterministic selection when multiple eligible owners are available.
- **TE-007**: Tests MUST verify that all acceptance and regression expectations from spec 001 continue to hold unchanged after the assignment enhancement is added.

### Key Entities *(include if feature involves data)*

- **Issue Assignment Evaluation**: A routing decision record containing the issue, current assignees, eligible owner candidates, deterministic selection result, assignment outcome, and any failure reason.
- **Eligible Organization Owner**: A candidate approver who is an organization owner, assignable on the workflow repository, active at evaluation time, and not the requester.
- **Assignment Outcome**: The recorded result of the routing step, including assigned, already_satisfied, corrected, or assignment_failed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of valid approval-ready add-team-members requests with at least one eligible assignee are assigned to an eligible organization owner during the same workflow run that validates the request.
- **SC-002**: 100% of requests already assigned to an eligible organization owner complete reruns without unnecessary reassignment.
- **SC-003**: 100% of requests with no eligible assignable organization owner preserve the no-mutation approval-pending safety model and do not gain any false approval signal.
- **SC-004**: Operators can determine from the recorded workflow outcome whether assignment was performed, skipped as already satisfied, corrected, or failed without inspecting raw system internals.
- **SC-005**: The enhancement introduces no regression in the approval and execution guarantees already defined by `001-add-team-members`.

## Assumptions

- This enhancement applies only to the existing add-team-members IssueOps workflow defined by `001-add-team-members`.
- GitHub issue assignment is used as a notification-routing aid and does not replace the explicit approval action required by spec 001.
- Repository assignability remains distinct from organization ownership, so some valid organization owners may be ineligible for assignment.
- Explicit rotation or load-balancing across eligible owners is out of scope unless introduced by a later feature.