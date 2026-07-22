# Feature Specification: Move Tenant GitHub-Hosted Runner

**Feature Branch**: `021-create-tenant-hosted-runner`
**Created**: 2026-06-12
**Status**: Complete
**Input**: Move one existing tenant GitHub-hosted runner into one existing tenant runner group.

## User Scenarios and Testing

### User Story 1 - Validate a Runner Move Request (Priority: P1)

A tenant administrator identifies one existing hosted runner by tenant-prefixed name, optionally supplies its numeric id to disambiguate duplicate names, and selects an existing tenant runner group.

**Independent Test**: Submit requests against unique, missing, and duplicate runner names and existing or missing target groups. Only an unambiguous runner and an existing same-tenant group become approval-ready.

**Acceptance Scenarios**:

1. Given one runner matches the derived tenant-prefixed name and the target group exists, validation resolves both ids and records a planned move.
2. Given multiple runners share the derived name and no runner id is supplied, validation rejects the request and asks for the id.
3. Given a runner id that does not match the named runner, validation rejects the request.
4. Given the runner or target group does not exist, validation rejects the request without creating either resource.
5. Given the target group belongs to another tenant namespace, validation rejects the request.
6. Given the runner is already in the target group, validation records no-op convergence.

### User Story 2 - Approve the Move (Priority: P2)

The designated active owner of the target organization comments exactly `approved` on the issue after validation.

**Independent Test**: Evaluate approval comments from the designated owner and other actors. Only the designated active owner unlocks execution.

**Acceptance Scenarios**:

1. The designated active organization owner can approve the current validated context.
2. A different commenter or non-owner cannot approve the move.
3. A changed tenant context marker invalidates prior approval and requires a fresh comment.

### User Story 3 - Execute and Audit the Move (Priority: P3)

After approval, the workflow revalidates tenant authorization and live runner and group state, patches the hosted runner with the target runner group id, and posts the result to the issue.

**Independent Test**: Execute approved requests for a required move, an already-satisfied move, and changed authorization state.

**Acceptance Scenarios**:

1. A required move calls the GitHub hosted-runner update endpoint once with the resolved runner id and target runner group id.
2. An already-satisfied request completes as no-op without an update call.
3. Changed requester authorization, a missing runner, or a missing target group blocks execution before mutation.
4. Every run writes a JSON audit artifact, step summary, terminal label when executed, and issue comment.

## Edge Cases

- Runner names are matched case-insensitively after tenant-prefix derivation.
- A supplied runner id must be a positive integer and must match the named runner.
- Duplicate runner names require the optional runner id.
- The target runner group must already exist and carry the resolved tenant prefix.
- Dry-run reports `move_hosted_runner` intent but performs no PATCH.
- API rate limits and transient failures use bounded retry.
- A successful API response that returns the updated runner is recorded as moved.

## Functional Requirements

- **FR-001**: The request MUST capture organization, tenant name, runner name, optional hosted runner id, target runner group name, designated approver, dry-run flag, and justification.
- **FR-002**: The system MUST derive the tenant-prefixed runner name using the shared hosted-runner naming rules.
- **FR-003**: The requester MUST be an active member of the tenant topology admin team resolved from `tenant-registry/`.
- **FR-004**: The designated approver MUST be an active owner of the target organization.
- **FR-005**: The runner MUST resolve by exact derived name, with the optional id used to disambiguate.
- **FR-006**: The target runner group MUST already exist and remain inside the resolved tenant namespace.
- **FR-007**: Missing runners and groups MUST be rejected. This operation MUST NOT create them.
- **FR-008**: A runner already in the target group MUST converge as no-op.
- **FR-009**: Execution MUST revalidate tenant authorization and live runner and group state after approval.
- **FR-010**: Mutation MUST use the organization-level hosted-runner update endpoint with only `runner_group_id`.
- **FR-011**: Dry-run MUST prevent mutation.
- **FR-012**: Mutation MUST require a PAT-backed token with organization hosted-runner administration permission.
- **FR-013**: Retry behavior MUST be bounded.
- **FR-014**: The workflow MUST emit audit artifact, step summary, terminal state label, and issue comment output.
- **FR-015**: The operation MUST remain idempotent across reruns.

## Key Entities

- **HostedRunnerMoveRequest**: Parsed issue request and tenant authorization context.
- **HostedRunnerResolution**: Runner name matches, optional id match, resolved runner id, status, and current group id.
- **TargetRunnerGroupResolution**: Requested name, resolved group id and name, and resolution status.
- **HostedRunnerMovePlan**: `move_hosted_runner`, `noop`, or `reject`, including boundary and blocked reason.
- **HostedRunnerMoveOutcome**: `moved`, `noop`, or `failed`, plus audit persistence and remediation fields.

## Success Criteria

- **SC-001**: All unauthorized requesters are rejected before approval.
- **SC-002**: All missing, ambiguous, id-mismatched, or cross-tenant targets are rejected before mutation.
- **SC-003**: Already-satisfied requests complete with zero mutation calls.
- **SC-004**: Approved valid requests send exactly one PATCH with the resolved `runner_group_id`.
- **SC-005**: Operators can determine the runner, old group, target group, approval state, planned action, and final result from the issue comment and artifact.

## Assumptions

- One issue moves one GitHub-hosted runner.
- Tenant topology admin membership is the current authorization boundary for tenant runner administration.
- GitHub hosted-runner names can require id disambiguation even if the current platform normally enforces uniqueness.
- The target runner group is provisioned by `create-tenant-runner-groups`.
