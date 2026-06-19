# Feature Specification: Tenant Runner Group Creation IssueOps Workflow

**Feature Branch**: `023-create-tenant-runner-groups`
**Created**: 2026-06-05
**Status**: Draft
**Input**: User description: "Create Tenant Runner Groups. Input parameters. Verify if user member team <tenant-slug>-admin. If not error. Create X_Tenant_Name runner group. Tenant context, tenant registry storage, and team derivation follow specs/014-create-tenant-model; tenant CI/CD authorization follows specs/021-create-tenant-hosted-runner."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

**Tenant Model Dependency**: This feature consumes the tenant model defined in `specs/014-create-tenant-model` and the tenant CI/CD authorization model introduced in `specs/021-create-tenant-hosted-runner` (canonical tenant topology admin team (`<tenant-slug>-admin`), deterministic tenant-prefixed naming, shared `tenant-registry/` resolution).


> **Topology update (2026-06-05):** Tenant context is now read from the canonical tenant topology in `tenant-registry/` defined by `specs/022-enhance-tenant-topology` (camelCase `tenantName`/`topology.teams.structure[]` with team types root/admin/repo-admin, plus a legacy-flat projection). The requester CI/CD authorization team is the tenant topology **admin** team (structure type "admin", `<tenant-slug>-admin`, carrying the `tenant-admin` role), not a separately-canonical tenant topology admin team (`<tenant-slug>-admin`). Inline references below to `<tenant-slug>-admin` derivation are superseded by this note.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Tenant Runner Group Requests (Priority: P1)

A tenant topology administrator submits a request in the central administration repository to create one Actions runner group for their tenant in a target GitHub organization, and the workflow validates tenant context resolution, requester CI/CD-admin team membership, derived group naming, and visibility parameters before any mutation is allowed.

**Why this priority**: Runner groups are the tenant isolation boundary for CI runners; safe intake with fail-closed tenant authorization is required before organization-level mutation can be reviewed or approved.

**Independent Test**: Can be fully tested by submitting requests from requesters who are and are not active members of the canonical tenant topology admin team, with valid and invalid group names and visibility values, and verifying only fully valid, tenant-authorized requests become approval-ready.

**Acceptance Scenarios**:

1. **Given** a requester who is an active member of the canonical tenant topology admin team (`<tenant-slug>-admin`) submits a valid organization, tenant name, and group base name, **When** validation completes, **Then** the workflow derives the tenant-prefixed group name and marks the request approval-ready with no mutation performed.
2. **Given** a requester who is not an active member of the canonical tenant topology admin team (`<tenant-slug>-admin`), **When** validation completes, **Then** the workflow rejects the request with an explicit authorization error and no mutation is attempted.
3. **Given** an invalid visibility value, **When** validation completes, **Then** the workflow rejects the request with an explicit finding.

---

### User Story 2 - Approve Tenant Runner Group Creation in Central Repo (Priority: P2)

A designated active owner of the target organization explicitly approves the request in the central repository, and the workflow verifies that approval identity against current organization ownership before execution is unlocked.

**Why this priority**: Runner groups govern which repositories can consume runners, so creation must be explicitly approved by the correct target-side authority in addition to tenant-level requester authorization.

**Independent Test**: Can be fully tested by creating valid requests and evaluating approvals from both authorized and unauthorized commenters.

**Acceptance Scenarios**:

1. **Given** a valid runner-group request with a designated approver who is an active owner of the target organization, **When** that approver comments the required approval signal, **Then** the workflow marks the request approved for execution.
2. **Given** a valid request but the approval signal is posted by a non-owner or non-designated actor, **When** approval is evaluated, **Then** the workflow denies approval and keeps execution blocked.
3. **Given** central issue assignment has occurred, **When** no valid approval signal is present, **Then** execution remains blocked and assignment is reported as routing-only metadata.

---

### User Story 3 - Reconcile and Execute Tenant Runner Group Creation (Priority: P3)

After valid approval, the workflow revalidates tenant boundary state, reads current organization runner-group state, creates the tenant-prefixed runner group only when missing with the requested visibility posture, and reports converged, no-op, blocked, failed, or partial outcomes with auditable evidence.

**Why this priority**: The business value is delivered only when tenant runner-group isolation converges safely, idempotently, and auditably.

**Independent Test**: Can be fully tested by running approved requests against organizations where the derived group is missing, already present, or where governance state changed after approval.

**Acceptance Scenarios**:

1. **Given** an approved request where no runner group with the derived name exists, **When** execution runs, **Then** the workflow creates the group with the requested visibility and public-repository policy and reports a created outcome with the new group identifier.
2. **Given** an approved request where a runner group with the derived name already exists, **When** execution runs, **Then** the workflow records a no-op outcome without duplicate group creation.
3. **Given** an approved request where tenant boundary revalidation no longer matches the validated context, **When** execution runs, **Then** the workflow blocks mutation and reports a boundary-mismatch outcome.

### Edge Cases

- The target organization is missing or not visible to the workflow credential.
- The tenant name does not resolve to exactly one tenant registry record for the target organization.
- The canonical tenant topology admin team (`<tenant-slug>-admin`) does not exist in the target organization.
- The requester has a pending (not active) membership in the topology admin team.
- The group base name normalizes to an empty value or produces an oversized derived name.
- The submitted base name already carries the tenant prefix (used as-is, no double-prefixing).
- A runner group with the derived name already exists with a different visibility posture (no-op for creation; drift is reported, not mutated).
- The organization plan does not support organization-level runner groups.
- The workflow token is missing, revoked, or lacks runner-group administration permission.
- Dry-run is requested and mutation steps must be skipped while still emitting plan and audit output.
- GitHub API rate limiting interrupts execution after validation succeeds.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized requester to submit one runner-group creation request for one tenant in one target GitHub organization.
- **FR-002**: The request MUST capture target organization, tenant name, group base name, optional visibility selection, optional public-repository allowance, designated approver login, explicit dry-run indicator, and justification.
- **FR-003**: The system MUST derive the full group name deterministically as `TenantName_GroupBaseName` using the 021 naming rules (whitespace to underscores; base names already carrying the exact tenant prefix used as-is).
- **FR-004**: The system MUST resolve canonical tenant context from per-tenant registry records under `tenant-registry/` following the `specs/014-create-tenant-model` registry contract.
- **FR-005**: The system MUST verify the requester is an active member of the canonical tenant topology admin team (`<tenant-slug>-admin`) and reject the request otherwise, failing closed when the team is missing.
- **FR-006**: Visibility MUST default to `selected` (repositories attached later) to preserve tenant isolation, and MUST accept only `selected`, `all`, or `private`.
- **FR-007**: The public-repository allowance MUST default to false.
- **FR-008**: The system MUST create the runner group only when no group with the derived name exists, and MUST treat an existing same-name group as no-op regardless of its configuration; configuration drift is reported as a finding, not mutated.
- **FR-009**: This feature MUST operate at organization level only.
- **FR-010**: The system MUST produce explicit final outcomes that distinguish successful mutation, no-op, blocked, failed, and partial-failure states.
- **FR-011**: Repository attachment to the group, moving runners into the group, group updates, and group deletion MUST remain out of scope for this version.

### Cross-Tenant Security Invariants

- **CTSI-001**: A requester MUST NOT be able to create a runner group carrying another tenant's prefix, because the group name is derived exclusively from the resolved tenant context.
- **CTSI-002**: Tenant authorization MUST be evaluated against live team-membership state at validation time, not against registry data alone.
- **CTSI-003**: Tenant boundary state MUST be revalidated at execution time, and mutation MUST be blocked when revalidation does not match the approved context.
- **CTSI-004**: Approval by a target-org owner MUST NOT substitute for requester tenant CI/CD-admin membership; both authorizations are independently required.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the GitHub user who created the central repository request.
- **AR-002**: Requester authorization MUST require active membership in the canonical tenant topology admin team (`<tenant-slug>-admin`) in the target organization at validation time.
- **AR-003**: Approver identity MUST be derived from the GitHub user who posts the explicit approval comment in the central repository.
- **AR-004**: A valid approver MUST be designated in the request and MUST be an active owner of the target organization at approval evaluation time.
- **AR-005**: Approval MUST be denied if the approver is not both designated and currently an active target-org owner.
- **AR-006**: Executing credential MUST use `ISSUEOPS_GITHUB_TOKEN` with least-privilege permissions required for organization reads, team-membership reads, runner-group administration, and central issue updates.
- **AR-007**: The workflow MUST fail closed when the token is missing, insufficient, revoked, or unauthorized for required reads or mutations.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue form payload MUST be parsed into structured fields before any mutation step can be considered.
- **VS-002**: Validation MUST verify target organization visibility and accessibility to workflow credentials.
- **VS-003**: Validation MUST resolve tenant context from the tenant registry and verify the derived topology admin team exists with the requester holding active membership.
- **VS-004**: Validation MUST verify deterministic group-name derivation and reject empty or oversized derived names.
- **VS-005**: Validation MUST verify the visibility value against the allowed set and apply documented defaults.
- **VS-006**: Validation MUST detect an existing runner group with the derived name and mark the request for no-op convergence.
- **VS-007**: Validation MUST verify designated approver membership and active-owner role in the target organization.
- **VS-008**: Validation MUST support dry-run mode that emits full reconciliation intent without mutation.
- **VS-009**: Validation MUST return clear, actionable findings for missing resources, authorization failures, and conflicting state.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as one runner group with the derived tenant-prefixed name existing in the target organization.
- **RL-002**: Reconciliation MUST read current organization runner-group state before mutation.
- **RL-003**: Reconciliation MUST create the group only when missing and treat an existing same-name group as no-op.
- **RL-004**: Reconciliation MUST remain idempotent and safe to rerun without duplicate side effects.
- **RL-005**: Reconciliation MUST recompute tenant boundary and group state at execution time and block mutation on boundary mismatch.
- **RL-006**: Dry-run reconciliation MUST report the full intended action set without mutation.

### Rollback Handling *(mandatory)*

- **RH-001**: If no mutation occurs before failure, the system MUST report zero-change failure.
- **RH-002**: A created group that cannot be confirmed yields partial failure with the group identifier surfaced for operator follow-up.
- **RH-003**: The workflow MUST fail closed on authorization, validation, or approval precondition failure.
- **RH-004**: The machine-readable outcome MUST include rollback status and manual recovery steps when full convergence cannot be confirmed.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured audit evidence for intake, validation, approval, reconciliation plan, mutation actions, and final status.
- **OR-002**: Required correlation fields MUST include issue number, workflow run id, requester, approver, target organization, tenant key, derived group name, requested visibility, created group identifier, and per-step outcome.
- **OR-003**: The human-readable step summary MUST report dry-run status, approval state, tenant authorization findings, mutation or no-op decisions, and any remediation guidance.
- **OR-004**: The machine-readable artifact MUST include per-step outcomes and the final lifecycle state for the runner-group operation.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The workflow MUST minimize unnecessary API calls by reusing validated state where safe and fetching only required resources.
- **GH-002**: Retry behavior MUST be bounded and include backoff for retryable and secondary rate-limit responses.
- **GH-003**: On exhausted retry budget or non-retryable API failures, the workflow MUST stop safely, preserve partial outcomes, and surface operator retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST cover valid and invalid request parsing for organization, tenant name, group name, visibility, public-repository allowance, dry-run, and justification fields.
- **TE-002**: Tests MUST cover group-name derivation, pre-prefixed base names, and oversized-name rejection.
- **TE-003**: Tests MUST cover requester authorization for active members and non-members of the derived topology admin team, and the missing-team fail-closed path.
- **TE-004**: Tests MUST cover approval-gate behavior for authorized active-owner approvers and unauthorized actors.
- **TE-005**: Tests MUST cover reconciliation behavior for the create path, the existing-group no-op path, and rerun convergence.
- **TE-006**: Tests MUST cover visibility validation including the `selected` default and invalid-value rejection.
- **TE-007**: Tests MUST cover missing or insufficient token failure and fail-closed behavior.
- **TE-008**: Tests MUST cover dry-run behavior to ensure no organization mutation occurs.
- **TE-009**: Tests MUST cover execution-time boundary revalidation mismatch blocking.

### Key Entities *(include if feature involves data)*

- **RunnerGroupCreationRequest**: The parsed request record containing requester, target organization, tenant name, group base name, visibility, public-repository allowance, dry-run flag, justification, approval state, validation results, and execution outcomes.
- **TenantCicdContext**: The resolved tenant governance context (shared with 021) authorizing the requester for topology administration.
- **DerivedRunnerGroupName**: The deterministic tenant-prefixed group name with derivation status and constraint findings.
- **RunnerGroupReconciliationPlan**: The desired-versus-current diff with creation action (`create_runner_group` | `noop` | `reject`), blocked reason, and dry-run posture.
- **RunnerGroupExecutionOutcome**: Audit-grade per-step execution result including the group creation result, created group identifier, and final lifecycle state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests from users without active derived topology admin team membership are rejected before approval with an explicit authorization error.
- **SC-002**: 100% of execution attempts without valid designated active-owner approval remain blocked from mutation.
- **SC-003**: 100% of reruns for already-satisfied group state complete as no-op without duplicate group creation.
- **SC-004**: 100% of created runner groups carry the derived tenant naming prefix; no execution path can create a group outside the resolved tenant naming boundary.
- **SC-005**: For completed runs, operators can determine from summary and artifact whether group creation was applied, skipped, blocked, or failed without inspecting raw API logs.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository issue-form flow.
- One request manages exactly one runner group for exactly one tenant in exactly one target organization.
- Tenant registry records under `tenant-registry/` are maintained by the 014 tenant bootstrap workflow and are authoritative for tenant context resolution.
- The tenant topology admin team (`<tenant-slug>-admin`) is provisioned by a separate governance process; this feature only verifies its existence and the requester's membership.
- `ISSUEOPS_GITHUB_TOKEN` is PAT-backed and scoped for runner-group administration (`admin:org` classic scope or the equivalent fine-grained organization self-hosted-runners permission).
- The target organization is on a GitHub plan that supports organization-level runner groups (GitHub Team or Enterprise Cloud).
- Repository attachment and runner placement into the created group flow through sibling operations (the move-runners operation is a future feature; hosted-runner creation can target the group via feature 021).
