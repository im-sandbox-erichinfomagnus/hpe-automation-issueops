# Feature Specification: Tenant GitHub-Hosted Runner Deletion IssueOps Workflow

**Feature Branch**: `022-delete-tenant-hosted-runner`
**Created**: 2026-06-05
**Status**: Draft
**Input**: User description: "Delete GitHub-Hosted Runner (org level only). Verify if user member team X_Tenant_CICDAdmin. If not error. Delete X_Tenant_Name runner. Tenant context, tenant registry storage, and team derivation follow specs/014-create-tenant-model; tenant CI/CD authorization follows specs/021-create-tenant-hosted-runner."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

**Tenant Model Dependency**: This feature consumes the tenant model defined in `specs/014-create-tenant-model` and the tenant CI/CD authorization model introduced in `specs/021-create-tenant-hosted-runner` (derived `TenantName_CICDAdmins` team, deterministic tenant-prefixed runner naming, shared `tenant-registry/` resolution).


> **Topology update (2026-06-05):** Tenant context is now read from the canonical tenant topology in `tenant-registry/` defined by `specs/022-enhance-tenant-topology` (camelCase `tenantName`/`topology.teams.structure[]` with team types root/admin/repo-admin, plus a legacy-flat projection). The requester CI/CD authorization team is the tenant topology **admin** team (structure type "admin", `<tenant-slug>-admin`, carrying the `tenant-admin` role), not a separately-derived `TenantName_CICDAdmins` team. Inline references below to `TenantName_CICDAdmins` derivation are superseded by this note.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Tenant Runner Deletion Requests (Priority: P1)

A tenant CI/CD administrator submits a request in the central administration repository to delete one GitHub-hosted runner belonging to their tenant in a target GitHub organization, and the workflow validates tenant context resolution, requester CI/CD-admin team membership, derived runner naming, and current runner existence before any mutation is allowed.

**Why this priority**: Deletion is destructive to tenant CI capacity, so fail-closed tenant authorization and unambiguous runner targeting are required before review or approval.

**Independent Test**: Can be fully tested by submitting requests from requesters who are and are not active members of the derived tenant CI/CD admin team, against runners that exist and do not exist, and verifying only tenant-authorized requests become approval-ready.

**Acceptance Scenarios**:

1. **Given** a requester who is an active member of the derived `TenantName_CICDAdmins` team names an existing tenant runner, **When** validation completes, **Then** the workflow resolves the runner identifier and marks the request approval-ready with no mutation performed.
2. **Given** a requester who is not an active member of the derived `TenantName_CICDAdmins` team, **When** validation completes, **Then** the workflow rejects the request with an explicit authorization error and no mutation is attempted.
3. **Given** no hosted runner with the derived name exists, **When** validation completes, **Then** the request remains valid and is marked for no-op convergence with an explicit warning.

---

### User Story 2 - Approve Tenant Runner Deletion in Central Repo (Priority: P2)

A designated active owner of the target organization explicitly approves the request in the central repository, and the workflow verifies that approval identity against current organization ownership before execution is unlocked.

**Why this priority**: Runner deletion removes organization-level CI infrastructure and must be explicitly approved by the correct target-side authority in addition to tenant-level requester authorization.

**Independent Test**: Can be fully tested by creating valid requests and evaluating approvals from both authorized and unauthorized commenters to verify that only a designated, active target-org owner approval unlocks execution.

**Acceptance Scenarios**:

1. **Given** a valid deletion request with a designated approver who is an active owner of the target organization, **When** that approver comments the required approval signal, **Then** the workflow marks the request approved for execution.
2. **Given** a valid request but the approval signal is posted by a non-owner or non-designated actor, **When** approval is evaluated, **Then** the workflow denies approval and keeps execution blocked.
3. **Given** central issue assignment has occurred, **When** no valid approval signal is present, **Then** execution remains blocked and assignment is reported as routing-only metadata.

---

### User Story 3 - Reconcile and Execute Tenant Runner Deletion (Priority: P3)

After valid approval, the workflow revalidates tenant boundary state, re-reads current organization hosted-runner state, deletes the tenant-prefixed runner only when present, treats an already-absent runner as converged no-op, and reports outcomes with auditable evidence.

**Why this priority**: The business value is delivered only when tenant runner decommissioning converges safely, idempotently, and auditably.

**Independent Test**: Can be fully tested by running approved requests against organizations where the derived runner is present, already absent, or where governance state changed after approval, verifying deleted, no-op, and blocked outcomes respectively.

**Acceptance Scenarios**:

1. **Given** an approved request where the derived runner exists, **When** execution runs, **Then** the workflow deletes the runner by its resolved identifier and reports a deleted outcome.
2. **Given** an approved request where the derived runner is already absent, **When** execution runs, **Then** the workflow records a no-op outcome without any deletion call.
3. **Given** an approved request where tenant boundary revalidation no longer matches the validated context, **When** execution runs, **Then** the workflow blocks mutation and reports a boundary-mismatch outcome with remediation guidance.

### Edge Cases

- The target organization is missing or not visible to the workflow credential.
- The tenant name does not resolve to exactly one tenant registry record for the target organization.
- The derived `TenantName_CICDAdmins` team does not exist in the target organization.
- The requester has a pending (not active) membership in the CI/CD admin team.
- The submitted runner name carries another tenant's prefix (derivation confines targeting to the resolved tenant's prefix).
- The runner exists at validation time but is deleted by another actor before execution (platform 404 treated as converged no-op).
- The runner is busy executing jobs at deletion time (platform-side semantics; surfaced as failure if the API rejects).
- The workflow token is missing, revoked, or lacks hosted-runner administration permission.
- Dry-run is requested and mutation steps must be skipped while still emitting plan and audit output.
- GitHub API rate limiting interrupts execution after validation succeeds.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized requester to submit one GitHub-hosted runner deletion request for one tenant in one target GitHub organization.
- **FR-002**: The request MUST capture target organization, tenant name, runner name, designated approver login, explicit dry-run indicator, and justification.
- **FR-003**: The system MUST derive the full runner name deterministically using the 021 derivation rules, accepting either the tenant-prefixed full name or the base name.
- **FR-004**: The system MUST resolve canonical tenant context from per-tenant registry records under `tenant-registry/` following the `specs/014-create-tenant-model` registry contract.
- **FR-005**: The system MUST verify the requester is an active member of the derived `TenantName_CICDAdmins` team and reject the request otherwise, failing closed when the team is missing.
- **FR-006**: The system MUST resolve the existing hosted runner by exact derived-name match against current organization hosted-runner state and capture its identifier for deletion.
- **FR-007**: The system MUST delete the hosted runner only when present, and MUST treat an absent runner as converged no-op rather than failure.
- **FR-008**: Deletion MUST target only the runner whose name carries the resolved tenant's naming prefix; the derivation rule structurally prevents cross-tenant targeting.
- **FR-009**: This feature MUST operate at organization level only and MUST NOT mutate enterprise-level or repository-level runner state.
- **FR-010**: The system MUST produce explicit final outcomes that distinguish successful deletion, no-op, blocked, failed, and partial-failure states.
- **FR-011**: Hosted runner creation, runner-group management, and moving runners between groups MUST remain out of scope for this feature.

### Cross-Tenant Security Invariants

- **CTSI-001**: A requester MUST NOT be able to delete a runner carrying another tenant's prefix, because the deletion target name is derived exclusively from the resolved tenant context.
- **CTSI-002**: Tenant authorization MUST be evaluated against live team-membership state at validation time, not against registry data alone.
- **CTSI-003**: Tenant boundary state MUST be revalidated at execution time, and mutation MUST be blocked when revalidation does not match the approved context.
- **CTSI-004**: Approval by a target-org owner MUST NOT substitute for requester tenant CI/CD-admin membership; both authorizations are independently required.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the GitHub user who created the central repository request.
- **AR-002**: Requester authorization MUST require active membership in the derived `TenantName_CICDAdmins` team in the target organization at validation time.
- **AR-003**: Approver identity MUST be derived from the GitHub user who posts the explicit approval comment in the central repository.
- **AR-004**: A valid approver MUST be designated in the request and MUST be an active owner of the target organization at approval evaluation time.
- **AR-005**: Approval MUST be denied if the approver is not both designated and currently an active target-org owner.
- **AR-006**: Executing credential MUST use `ISSUEOPS_GITHUB_TOKEN` with least-privilege permissions required for organization reads, team-membership reads, hosted-runner administration, and central issue updates.
- **AR-007**: The workflow MUST fail closed when the token is missing, insufficient, revoked, or unauthorized for required reads or mutations.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue form payload MUST be parsed into structured fields before any mutation step can be considered.
- **VS-002**: Validation MUST verify target organization visibility and accessibility to workflow credentials.
- **VS-003**: Validation MUST resolve tenant context from the tenant registry and verify the derived CI/CD admin team exists with the requester holding active membership.
- **VS-004**: Validation MUST verify deterministic runner-name derivation and reject empty or invalid derived names.
- **VS-005**: Validation MUST read current hosted-runner state and resolve the target runner identifier when present.
- **VS-006**: Validation MUST verify designated approver membership and active-owner role in the target organization.
- **VS-007**: Validation MUST support dry-run mode that emits full reconciliation intent without mutation.
- **VS-008**: Validation MUST return clear, actionable findings for missing resources, authorization failures, and already-absent runners.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as no hosted runner with the derived tenant-prefixed name existing in the target organization.
- **RL-002**: Reconciliation MUST read current organization hosted-runner state before mutation.
- **RL-003**: Reconciliation MUST delete the runner only when present and treat an absent runner as no-op.
- **RL-004**: Reconciliation MUST remain idempotent and safe to rerun without duplicate side effects.
- **RL-005**: Reconciliation MUST recompute tenant boundary and runner state at execution time and block mutation on boundary mismatch.
- **RL-006**: A platform 404 on the deletion call MUST be treated as converged no-op, not failure.

### Rollback Handling *(mandatory)*

- **RH-001**: If no mutation occurs before failure, the system MUST report zero-change failure.
- **RH-002**: Deletion is not reversible; the audit artifact MUST capture the deleted runner's identifier, name, and configuration evidence sufficient for re-creation through the 021 creation workflow.
- **RH-003**: The workflow MUST fail closed on authorization, validation, or approval precondition failure.
- **RH-004**: The machine-readable outcome MUST include rollback status and re-creation guidance when deletion completes.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured audit evidence for intake, validation, approval, reconciliation plan, mutation actions, and final status.
- **OR-002**: Required correlation fields MUST include issue number, workflow run id, requester, approver, target organization, tenant key, derived runner name, resolved runner identifier, and per-step outcome.
- **OR-003**: The human-readable step summary MUST report dry-run status, approval state, tenant authorization findings, deletion or no-op decisions, and any remediation guidance.
- **OR-004**: The machine-readable artifact MUST include per-step outcomes and the final lifecycle state for the runner-deletion operation.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The workflow MUST minimize unnecessary API calls by reusing validated state where safe and fetching only required resources.
- **GH-002**: Retry behavior MUST be bounded and include backoff for retryable and secondary rate-limit responses.
- **GH-003**: On exhausted retry budget or non-retryable API failures, the workflow MUST stop safely, preserve partial outcomes, and surface operator retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST cover valid and invalid request parsing for organization, tenant name, runner name, dry-run, and justification fields.
- **TE-002**: Tests MUST cover runner-name derivation for both base-name and full-name submissions.
- **TE-003**: Tests MUST cover requester authorization for active members and non-members of the derived CI/CD admin team, and the missing-team fail-closed path.
- **TE-004**: Tests MUST cover approval-gate behavior for authorized active-owner approvers and unauthorized actors.
- **TE-005**: Tests MUST cover reconciliation behavior for the delete path, the absent-runner no-op path, and rerun convergence.
- **TE-006**: Tests MUST cover missing or insufficient token failure and fail-closed behavior.
- **TE-007**: Tests MUST cover dry-run behavior to ensure no organization mutation occurs.
- **TE-008**: Tests MUST cover execution-time boundary revalidation mismatch blocking.

### Key Entities *(include if feature involves data)*

- **HostedRunnerDeletionRequest**: The parsed request record containing requester, target organization, tenant name, runner name, dry-run flag, justification, approval state, validation results, and execution outcomes.
- **TenantCicdContext**: The resolved tenant governance context (shared with 021) authorizing the requester for CI/CD administration.
- **TargetRunnerResolution**: The resolved hosted-runner identifier, name, and status for the derived tenant-prefixed name, or an explicit absent marker.
- **HostedRunnerDeletionPlan**: The desired-versus-current diff with deletion action (`delete_hosted_runner` | `noop` | `reject`), blocked reason, and dry-run posture.
- **HostedRunnerDeletionOutcome**: Audit-grade per-step execution result including the deletion result and final lifecycle state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests from users without active derived CI/CD admin team membership are rejected before approval with an explicit authorization error.
- **SC-002**: 100% of execution attempts without valid designated active-owner approval remain blocked from mutation.
- **SC-003**: 100% of reruns against an already-absent runner complete as no-op without errors.
- **SC-004**: No execution path can delete a runner outside the resolved tenant naming boundary.
- **SC-005**: For completed runs, operators can determine from summary and artifact whether deletion was applied, skipped, blocked, or failed without inspecting raw API logs.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository issue-form flow.
- One request manages exactly one hosted runner for exactly one tenant in exactly one target organization.
- Tenant registry records under `tenant-registry/` are maintained by the 014 tenant bootstrap workflow and are authoritative for tenant context resolution.
- The tenant CI/CD administration team (`TenantName_CICDAdmins`) is provisioned by a separate governance process; this feature only verifies its existence and the requester's membership.
- `ISSUEOPS_GITHUB_TOKEN` is PAT-backed and scoped for hosted-runner administration (`manage_runners:org` classic scope or the equivalent fine-grained permission).
- The platform accepts deletion of hosted runners via `DELETE /orgs/{org}/actions/hosted-runners/{hosted_runner_id}` returning 202; in-flight job handling is platform-side behavior.
- Runner re-creation after deletion flows through the 021 creation workflow.
