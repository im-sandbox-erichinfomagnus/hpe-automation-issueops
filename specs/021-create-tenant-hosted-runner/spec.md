# Feature Specification: Tenant GitHub-Hosted Runner Creation IssueOps Workflow

**Feature Branch**: `021-create-tenant-hosted-runner`
**Created**: 2026-06-05
**Status**: Draft
**Input**: User description: "Create GitHub-Hosted Runner for X_Tenant (org level only). Configure parameters (Name, etc). Verify if user member team <tenant-slug>-admin. If not error. Create X_Tenant_Name runner. Tenant context, tenant registry storage, and team derivation follow specs/014-create-tenant-model."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

**Tenant Model Dependency**: This feature consumes the tenant model defined in `specs/014-create-tenant-model`. Tenant context is resolved from durable per-tenant registry records under `tenant-registry/` in this repository, and tenant team naming follows the same deterministic derivation used by tenant bootstrap (`TenantName_Tenant`, `TenantName_RepoAdmins`). This feature derives the tenant topology admin team as `<tenant-slug>-admin` using identical normalization rules.


> **Topology update (2026-06-05):** Tenant context is now read from the canonical tenant topology in `tenant-registry/` defined by `specs/022-enhance-tenant-topology` (camelCase `tenantName`/`topology.teams.structure[]` with team types root/admin/repo-admin, plus a legacy-flat projection). The requester CI/CD authorization team is the tenant topology **admin** team (structure type "admin", `<tenant-slug>-admin`, carrying the `tenant-admin` role), not a separately-canonical tenant topology admin team (`<tenant-slug>-admin`). Inline references below to `<tenant-slug>-admin` derivation are superseded by this note.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Tenant Runner Creation Requests (Priority: P1)

A tenant topology administrator submits a request in the central administration repository to create one GitHub-hosted runner for their tenant in a target GitHub organization, and the workflow validates tenant context resolution, requester CI/CD-admin team membership, derived runner naming, runner configuration parameters, and runner-group targeting before any mutation is allowed.

**Why this priority**: Safe and unambiguous request intake with fail-closed tenant authorization is required before privileged, billable runner infrastructure can be reviewed or approved.

**Independent Test**: Can be fully tested by submitting requests from requesters who are and are not active members of the canonical tenant topology admin team, with valid and invalid runner names, images, sizes, and runner-group references, and verifying that only fully valid, tenant-authorized requests become approval-ready while all others are rejected without organization mutation.

**Acceptance Scenarios**:

1. **Given** a requester who is an active member of the canonical tenant topology admin team (`<tenant-slug>-admin`) submits a valid organization, tenant name, runner base name, image, and machine size, **When** validation completes, **Then** the workflow derives the tenant-prefixed runner name and marks the request approval-ready with no mutation performed.
2. **Given** a requester who is not an active member of the canonical tenant topology admin team (`<tenant-slug>-admin`), **When** validation completes, **Then** the workflow rejects the request with an explicit authorization error and no mutation is attempted.
3. **Given** the canonical tenant topology admin team (`<tenant-slug>-admin`) does not exist in the target organization, **When** validation completes, **Then** the workflow fails closed with explicit remediation guidance and no mutation is attempted.
4. **Given** a requester submits a dry-run request, **When** validation and reconciliation complete, **Then** the workflow returns a reviewable runner-creation plan without mutating GitHub organization state.

---

### User Story 2 - Approve Tenant Runner Creation in Central Repo (Priority: P2)

A designated active owner of the target organization explicitly approves the request in the central repository, and the workflow verifies that approval identity against current organization ownership before execution is unlocked.

**Why this priority**: GitHub-hosted runners are billable, organization-level infrastructure, so creation must be explicitly approved by the correct target-side authority in addition to tenant-level requester authorization.

**Independent Test**: Can be fully tested by creating valid requests and evaluating approvals from both authorized and unauthorized commenters to verify that only a designated, active target-org owner approval unlocks execution.

**Acceptance Scenarios**:

1. **Given** a valid tenant runner-creation request with a designated approver who is an active owner of the target organization, **When** that approver comments the required approval signal, **Then** the workflow marks the request approved for execution.
2. **Given** a valid request but the approval signal is posted by a non-owner or non-designated actor, **When** approval is evaluated, **Then** the workflow denies approval and keeps execution blocked.
3. **Given** central issue assignment has occurred, **When** no valid approval signal is present, **Then** execution remains blocked and assignment is reported as routing-only metadata.

---

### User Story 3 - Reconcile and Execute Tenant Runner Creation (Priority: P3)

After valid approval, the workflow revalidates tenant boundary state, reads current organization hosted-runner state, creates the tenant-prefixed GitHub-hosted runner only when missing, targets the resolved runner group, and reports converged, no-op, blocked, failed, or partial outcomes with auditable evidence.

**Why this priority**: The business value is delivered only when tenant-scoped runner infrastructure converges safely, idempotently, and auditably.

**Independent Test**: Can be fully tested by running approved requests against organizations where the derived runner is missing, already present, or where the target runner group is unresolvable, and verifying mutation, no-op, and blocked outcomes respectively.

**Acceptance Scenarios**:

1. **Given** an approved request where no hosted runner with the derived name exists, **When** execution runs, **Then** the workflow creates the runner with the requested image, size, and resolved runner group, and reports a created outcome with the new runner identifier.
2. **Given** an approved request where a hosted runner with the derived name already exists, **When** execution runs, **Then** the workflow records a no-op outcome without duplicate runner creation.
3. **Given** an approved request where tenant boundary revalidation no longer matches the validated context, **When** execution runs, **Then** the workflow blocks mutation and reports a boundary-mismatch outcome with remediation guidance.

### Edge Cases

- The target organization is missing or not visible to the workflow credential.
- The tenant name does not resolve to exactly one tenant registry record for the target organization.
- The canonical tenant topology admin team (`<tenant-slug>-admin`) does not exist in the target organization.
- The requester has a pending (not active) membership in the topology admin team.
- The runner base name normalizes to an empty value or produces a derived name longer than 64 characters or containing characters outside the allowed runner-name set.
- The requested runner group name does not match the tenant naming pattern.
- The requested runner group does not exist in the target organization.
- No runner group is provided and the organization default runner group cannot be resolved.
- The requested image or machine size is not available to the organization.
- A hosted runner with the derived name already exists (no-op convergence).
- The workflow token is missing, revoked, or lacks hosted-runner administration permission.
- Dry-run is requested and mutation steps must be skipped while still emitting plan and audit output.
- GitHub API rate limiting interrupts execution after validation succeeds.
- The designated approver loses active-owner status between validation and approval evaluation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized requester to submit one GitHub-hosted runner creation request for one tenant in one target GitHub organization.
- **FR-002**: The request MUST capture target organization, tenant name, runner base name, runner image identifier, runner image source, machine size, optional runner group name, optional maximum runner count, designated approver login, explicit dry-run indicator, and justification.
- **FR-003**: The system MUST derive the full runner name deterministically as the tenant display name with whitespace converted to underscores, followed by an underscore and the normalized runner base name (`TenantName_RunnerBaseName`).
- **FR-004**: The system MUST validate the derived runner name against GitHub hosted-runner naming constraints (1 to 64 characters; letters, digits, `.`, `-`, `_` only) and reject derivations that fail.
- **FR-005**: The system MUST resolve canonical tenant context from per-tenant registry records under `tenant-registry/` following the `specs/014-create-tenant-model` registry contract, and reject requests whose tenant name does not resolve to exactly one record for the target organization.
- **FR-006**: The system MUST derive the tenant topology admin team as `<tenant-slug>-admin` using the same normalization rules as tenant bootstrap team derivation.
- **FR-007**: The system MUST verify the requester is an active member of the derived tenant topology admin team and reject the request otherwise.
- **FR-008**: If the derived tenant topology admin team does not exist in the target organization, the system MUST fail closed with explicit remediation guidance and MUST NOT create the team.
- **FR-009**: When a runner group name is provided, the system MUST require the name to match the tenant naming pattern (`TenantName_` prefix) and to exist in the target organization, and MUST resolve it to its runner group identifier.
- **FR-010**: When no runner group name is provided, the system MUST resolve the organization default runner group and target it for runner creation.
- **FR-011**: The system MUST create the hosted runner only when no hosted runner with the derived name exists in the target organization, and MUST treat an existing same-name runner as no-op.
- **FR-012**: This feature MUST operate at organization level only and MUST NOT mutate enterprise-level or repository-level runner state.
- **FR-013**: The system MUST produce explicit final outcomes that distinguish successful mutation, no-op, blocked, failed, and partial-failure states.
- **FR-014**: Hosted runner deletion, runner-group creation, and moving runners between groups MUST remain out of scope for this feature (covered by sibling features).
- **FR-015**: Custom image lifecycle management (creation, versioning, deletion) MUST remain out of scope for this version.

### Cross-Tenant Security Invariants

- **CTSI-001**: A requester MUST NOT be able to create a runner whose derived name carries another tenant's prefix, because the runner name is derived exclusively from the resolved tenant context.
- **CTSI-002**: A requester MUST NOT be able to target a runner group carrying another tenant's naming prefix.
- **CTSI-003**: Tenant authorization MUST be evaluated against live team-membership state at validation time, not against registry data alone.
- **CTSI-004**: Tenant boundary state MUST be revalidated at execution time, and mutation MUST be blocked when revalidation does not match the approved context.
- **CTSI-005**: Approval by a target-org owner MUST NOT substitute for requester tenant CI/CD-admin membership; both authorizations are independently required.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the GitHub user who created the central repository request.
- **AR-002**: Requester authorization MUST require active membership in the canonical tenant topology admin team (`<tenant-slug>-admin`) in the target organization at validation time.
- **AR-003**: Approver identity MUST be derived from the GitHub user who posts the explicit approval comment in the central repository.
- **AR-004**: A valid approver MUST be designated in the request and MUST be an active owner of the target organization at approval evaluation time.
- **AR-005**: Approval MUST be denied if the approver is not both designated and currently an active target-org owner.
- **AR-006**: Executing credential MUST use `ISSUEOPS_GITHUB_TOKEN` with least-privilege permissions required for organization reads, team-membership reads, hosted-runner administration, and central issue updates.
- **AR-007**: The workflow MUST fail closed when the token is missing, insufficient, revoked, or unauthorized for required reads or mutations.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue form payload MUST be parsed into structured fields before any mutation step can be considered.
- **VS-002**: Validation MUST verify target organization visibility and accessibility to workflow credentials.
- **VS-003**: Validation MUST resolve tenant context from the tenant registry and verify governance relationships per the 014 tenant model.
- **VS-004**: Validation MUST verify the derived topology admin team exists and the requester holds active membership in it.
- **VS-005**: Validation MUST verify deterministic runner-name derivation and reject empty, unsafe, oversized, or invalid derived names.
- **VS-006**: Validation MUST verify runner image identifier, image source, and machine size inputs are present and well-formed, and SHOULD verify availability against organization hosted-runner reference data when accessible.
- **VS-007**: Validation MUST resolve the target runner group (explicit tenant-patterned group or organization default) and reject unresolvable targets.
- **VS-008**: Validation MUST verify designated approver membership and active-owner role in the target organization.
- **VS-009**: Validation MUST detect an existing hosted runner with the derived name and mark the request for no-op convergence.
- **VS-010**: Validation MUST support dry-run mode that emits full reconciliation intent without mutation.
- **VS-011**: Validation MUST return clear, actionable findings for missing resources, authorization failures, and conflicting state.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as one hosted runner with the derived tenant-prefixed name existing in the target organization within the resolved runner group.
- **RL-002**: Reconciliation MUST read current organization hosted-runner state before mutation.
- **RL-003**: Reconciliation MUST create the runner only when missing and treat an existing same-name runner as no-op.
- **RL-004**: Reconciliation MUST remain idempotent and safe to rerun without duplicate side effects.
- **RL-005**: Reconciliation MUST recompute tenant boundary and runner state at execution time and block mutation on boundary mismatch.
- **RL-006**: Dry-run reconciliation MUST report the full intended action set without mutation.

### Rollback Handling *(mandatory)*

- **RH-001**: If no mutation occurs before failure, the system MUST report zero-change failure.
- **RH-002**: If runner creation is accepted by the platform but the runner enters a failed provisioning state, the system MUST report partial failure with the runner identifier and explicit operator remediation guidance.
- **RH-003**: The workflow MUST fail closed on authorization, validation, or approval precondition failure.
- **RH-004**: The machine-readable outcome MUST include rollback status and manual recovery steps when full convergence cannot be confirmed.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured audit evidence for intake, validation, approval, reconciliation plan, mutation actions, and final status.
- **OR-002**: Required correlation fields MUST include issue number, workflow run id, requester, approver, target organization, tenant key, derived runner name, resolved runner group identifier, and per-step outcome.
- **OR-003**: The human-readable step summary MUST report dry-run status, approval state, tenant authorization findings, mutation or no-op decisions, and any remediation guidance.
- **OR-004**: The machine-readable artifact MUST include per-step outcomes and the final lifecycle state for the runner-creation operation.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The workflow MUST minimize unnecessary API calls by reusing validated state where safe and fetching only required resources.
- **GH-002**: Retry behavior MUST be bounded and include backoff for retryable and secondary rate-limit responses.
- **GH-003**: On exhausted retry budget or non-retryable API failures, the workflow MUST stop safely, preserve partial outcomes, and surface operator retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST cover valid and invalid request parsing for organization, tenant name, runner base name, image, size, runner group, maximum runners, dry-run, and justification fields.
- **TE-002**: Tests MUST cover runner-name derivation, naming-constraint rejection, and topology admin team-name derivation.
- **TE-003**: Tests MUST cover requester authorization for active members, non-members, and pending members of the derived topology admin team, and the missing-team fail-closed path.
- **TE-004**: Tests MUST cover approval-gate behavior for authorized active-owner approvers and unauthorized actors.
- **TE-005**: Tests MUST cover reconciliation behavior for the create path, the existing-runner no-op path, and rerun convergence.
- **TE-006**: Tests MUST cover runner-group resolution for explicit tenant-patterned groups, the default-group fallback, and unresolvable-group rejection.
- **TE-007**: Tests MUST cover missing or insufficient token failure and fail-closed behavior.
- **TE-008**: Tests MUST cover dry-run behavior to ensure no organization mutation occurs.
- **TE-009**: Tests MUST cover bounded retry and partial-failure observability under throttling or interruption.
- **TE-010**: Tests MUST cover execution-time boundary revalidation mismatch blocking.

### Key Entities *(include if feature involves data)*

- **HostedRunnerCreationRequest**: The parsed request record containing requester, target organization, tenant name, runner base name, image, size, runner group reference, maximum runners, dry-run flag, justification, approval state, validation results, and execution outcomes.
- **TenantCicdContext**: The resolved tenant governance context combining the canonical registry record (per 014) with the derived topology admin team name/slug, team existence state, and requester membership state.
- **DerivedRunnerName**: The deterministic tenant-prefixed runner name with derivation status and constraint-validation findings.
- **RunnerGroupResolution**: The resolved runner-group target (explicit tenant-patterned group or organization default) with its identifier and resolution status.
- **HostedRunnerReconciliationPlan**: The desired-versus-current diff with creation action (`create_hosted_runner` | `noop` | `reject`), blocked reason, and dry-run posture.
- **HostedRunnerExecutionOutcome**: Audit-grade per-step execution result including runner creation result, created runner identifier, rollback status, and final lifecycle state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests from users without active derived topology admin team membership are rejected before approval with an explicit authorization error.
- **SC-002**: 100% of execution attempts without valid designated active-owner approval remain blocked from mutation.
- **SC-003**: 100% of reruns for already-satisfied runner state complete as no-op without duplicate runner creation.
- **SC-004**: 100% of created runners carry the derived tenant naming prefix; no execution path can create a runner outside the resolved tenant naming boundary.
- **SC-005**: For completed runs, operators can determine from summary and artifact whether runner creation was applied, skipped, blocked, or failed without inspecting raw API logs.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository issue-form flow.
- One request manages exactly one hosted runner for exactly one tenant in exactly one target organization.
- Tenant registry records under `tenant-registry/` are maintained by the 014 tenant bootstrap workflow and are the authoritative source for tenant context resolution.
- The tenant topology admin team (`<tenant-slug>-admin`) is provisioned by a separate governance process; this feature only verifies its existence and the requester's membership.
- `ISSUEOPS_GITHUB_TOKEN` is PAT-backed and can be scoped to least-privilege permissions needed for hosted-runner administration (`manage_runners:org` classic scope or the equivalent fine-grained organization hosted-runner permission).
- GitHub-hosted runner creation incurs usage-based billing in the target organization; the designated approver accepts billing accountability at approval time.
- The target organization is on a GitHub plan that supports organization-level GitHub-hosted runner administration (GitHub Enterprise Cloud).
- Runner-group governance beyond resolution and pattern checks (creation, repository access scoping) is intentionally deferred to the sibling runner-group feature.
