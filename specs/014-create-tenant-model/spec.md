# Feature Specification: Tenant Creation IssueOps Workflow

**Feature Branch**: `014-tenant-creation-model`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for a Tenant Creation IssueOps workflow in this central administration repository..."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit and Validate Tenant Bootstrap Requests (Priority: P1)

An authorized requester submits a tenant-creation request in the central administration repository for a target GitHub organization, and the workflow validates tenant naming, derived team naming, approver eligibility, and registry persistence prerequisites before any mutation is allowed.

**Why this priority**: Safe and unambiguous request intake is required before privileged organization changes can be reviewed or approved.

**Independent Test**: Can be fully tested by submitting requests with valid and invalid tenant names, organization values, and dry-run flags, and verifying that only valid requests become approval-ready while invalid requests are rejected without organization mutation.

**Acceptance Scenarios**:

1. **Given** a requester submits a valid target organization, tenant name, and justification, **When** validation completes, **Then** the workflow derives normalized tenant team names and marks the request approval-ready with no mutation performed.
2. **Given** a requester submits a tenant name that produces invalid or conflicting derived slugs, **When** validation completes, **Then** the workflow rejects the request with explicit errors and no mutation is attempted.
3. **Given** a requester submits a dry-run request, **When** validation and reconciliation complete, **Then** the workflow returns a reviewable reconciliation plan and registry-write intent without mutating GitHub organization state.

---

### User Story 2 - Approve Tenant Creation in Central Repo (Priority: P2)

A designated active owner of the target organization explicitly approves the request in the central repository, and the workflow verifies that approval identity against current organization ownership before execution is unlocked.

**Why this priority**: Tenant creation introduces privileged team and hierarchy changes and must be explicitly approved by the correct target-side authority.

**Independent Test**: Can be fully tested by creating valid requests and evaluating approvals from both authorized and unauthorized commenters to verify that only an active target-org owner approval unlocks execution.

**Acceptance Scenarios**:

1. **Given** a valid tenant-creation request with a designated approver who is an active owner of the target organization, **When** that approver comments the required approval signal, **Then** the workflow marks the request approved for execution.
2. **Given** a valid request but the approval signal is posted by a non-owner or non-designated actor, **When** approval is evaluated, **Then** the workflow denies approval and keeps execution blocked.
3. **Given** central issue assignment has occurred, **When** no valid approval signal is present, **Then** execution remains blocked and assignment is reported as routing-only metadata.

---

### User Story 3 - Reconcile Tenant Structure and Persist Registry (Priority: P3)

After valid approval, the workflow reconciles current state in the target organization, creates only missing tenant teams, links hierarchy only when needed, assigns requester as tenant-team maintainer if required, and persists a durable per-tenant registry file in this repository.

**Why this priority**: The business value is delivered only when tenant structure and durable tenant registry state converge safely and are auditable.

**Independent Test**: Can be fully tested by running approved requests against empty, partially satisfied, and already satisfied tenant states and verifying no-op behavior, partial-failure behavior, and durable registry persistence outcomes.

**Acceptance Scenarios**:

1. **Given** an approved request where derived teams do not exist, **When** execution runs, **Then** the workflow creates `TenantName_Tenant`, creates `TenantName_RepoAdmins`, links `TenantName_RepoAdmins` under `TenantName_Tenant`, adds requester as maintainer of `TenantName_Tenant`, and persists the per-tenant registry file.
2. **Given** an approved request where all desired team and hierarchy state already exists and requester is already maintainer, **When** execution runs, **Then** the workflow records a no-op reconciliation and updates or confirms registry state without duplicate mutation.
3. **Given** an approved request where organization mutation succeeds but durable tenant-registry persistence fails, **When** execution completes, **Then** the workflow reports partial failure with explicit remediation guidance and does not report full success.

### Edge Cases

- The target organization is missing or not visible to the workflow credential.
- Tenant name normalizes to an empty, invalid, or reserved team slug.
- Derived team names produce slug conflicts with each other or existing unrelated teams.
- Derived child team already exists but is currently linked to a different parent team.
- Requester is not a member of the target organization and therefore cannot be assigned as team maintainer.
- Requester is already a team maintainer and bootstrap assignment should be no-op.
- Designated approver is no longer an active owner at approval time.
- Approval signal exists but was posted before latest relevant validation in a way that should not authorize execution.
- Workflow token is missing, revoked, or lacks permission for organization mutation.
- Dry-run is requested and mutation steps must be skipped while still emitting plan/audit output.
- Durable tenant registry path is unavailable, unsafe, conflicting, or cannot be written.
- GitHub API rate limiting interrupts execution after some reconciliation steps succeed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an authorized requester to submit one tenant-creation request for one target GitHub organization.
- **FR-002**: The request MUST capture target organization, tenant name, designated approver login, optional dry-run indicator, and justification.
- **FR-003**: The system MUST derive exactly two tenant team names from tenant name input: `TenantName_Tenant` and `TenantName_RepoAdmins`.
- **FR-004**: The system MUST normalize and validate derived team names/slugs and reject ambiguous, conflicting, or invalid outputs.
- **FR-005**: The system MUST create only missing derived teams and treat pre-existing matching teams as no-op.
- **FR-006**: The system MUST link `TenantName_RepoAdmins` as a child of `TenantName_Tenant`.
- **FR-007**: If `TenantName_RepoAdmins` is already linked under `TenantName_Tenant`, the system MUST treat hierarchy linkage as no-op.
- **FR-008**: If `TenantName_RepoAdmins` is currently linked under a different parent team, the system MUST reject mutation for this request version and surface clear remediation guidance.
- **FR-009**: The system MUST ensure the requester is assigned as maintainer of `TenantName_Tenant`.
- **FR-010**: If requester is already maintainer, the system MUST treat requester maintainer assignment as no-op.
- **FR-011**: If requester is a non-maintainer member on `TenantName_Tenant`, the system MUST promote requester to maintainer.
- **FR-012**: This feature MUST NOT add or remove users outside requester bootstrap assignment requirements for `TenantName_Tenant`.
- **FR-013**: The system MUST emit a durable, per-tenant registry file under `tenant-registry/` in this repository.
- **FR-013A**: The `tenant-registry/` directory MUST be treated as a pre-provisioned repository invariant for this feature version, and the workflow MUST fail fast with blocked or partial-failure status if it is missing.
- **FR-014**: The per-tenant registry file MUST include tenant key and display name, target organization, tenant parent team name/slug, tenant repo-admin team name/slug, bootstrap tenant admin login, requester identity, approver identity, lifecycle status, timestamps, and workflow run identifiers.
- **FR-015**: The preferred registry persistence mechanism MUST be an automated repository commit or pull request that writes the per-tenant file.
- **FR-016**: If preferred durable write is unavailable, the system MUST emit fallback run artifact evidence and mark the run as blocked or partially failed rather than fully successful.
- **FR-017**: Central issue assignment MUST remain routing-only and MUST NOT authorize execution by itself.
- **FR-018**: The system MUST produce explicit final outcomes that distinguish successful mutation, no-op, blocked, failed, and partial-failure states.
- **FR-019**: This feature MUST NOT modify repositories, repository permissions, rulesets, branch protections, team-repo bindings, or memberships outside the two tenant teams.
- **FR-020**: Native GitHub custom roles and tenant-scoped repository/ruleset administration MUST remain out of scope for this version.
- **FR-021**: Enforcing tenant boundaries across existing separate IssueOps workflows MUST remain out of scope for this version.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the GitHub user who created the central repository request.
- **AR-002**: Approver identity MUST be derived from the GitHub user who posts the explicit approval comment in the central repository.
- **AR-003**: A valid approver MUST be a designated active owner of the target organization at approval evaluation time.
- **AR-004**: Approval MUST be denied if approver is not both designated and currently an active target-org owner.
- **AR-005**: Executing credential MUST use `ISSUEOPS_GITHUB_TOKEN` with least-privilege permissions required for organization/team reads, team mutation, hierarchy linkage, maintainer assignment, and central issue updates.
- **AR-006**: Workflow MUST fail closed when token is missing, insufficient, revoked, or unauthorized for required reads/mutations.
- **AR-007**: Tenant admin capability in this version MUST be represented only by team-maintainer assignment plus registry metadata and MUST NOT imply org-owner privilege elevation.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue form payload MUST be parsed into structured fields before any mutation step can be considered.
- **VS-002**: Validation MUST verify target organization visibility and accessibility to workflow credentials.
- **VS-003**: Validation MUST verify tenant name format and deterministic derivation of team names/slugs.
- **VS-004**: Validation MUST reject tenant input that yields empty, invalid, unsafe, or colliding team slugs.
- **VS-005**: Validation MUST verify existing team state and detect conflicts with unrelated pre-existing teams.
- **VS-006**: Validation MUST verify hierarchy preconditions and explicitly reject re-parenting in this version.
- **VS-007**: Validation MUST verify requester identity and requester eligibility for maintainer assignment in target organization context.
- **VS-008**: Validation MUST verify designated approver membership and active-owner role in target organization.
- **VS-009**: Validation MUST verify tenant-registry path safety and uniqueness for per-tenant file persistence.
- **VS-009A**: Validation MUST verify that `tenant-registry/` exists as a pre-provisioned repository path before execution attempts durable registry persistence.
- **VS-010**: Validation MUST support dry-run mode that emits full reconciliation and persistence intent without mutation.
- **VS-011**: Validation MUST return clear, actionable findings for missing resources, role mismatches, and conflicting state.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as both tenant teams existing with correct parent-child relation, requester as maintainer of `TenantName_Tenant`, and durable per-tenant registry file persisted.
- **RL-002**: Reconciliation MUST read current organization, team, hierarchy, and membership state before mutation.
- **RL-003**: Reconciliation MUST create only missing teams and skip existing teams as no-op.
- **RL-004**: Reconciliation MUST apply hierarchy linkage only when missing and skip already-correct links as no-op.
- **RL-005**: Reconciliation MUST apply requester maintainer assignment only when required and skip if already satisfied.
- **RL-006**: Reconciliation MUST remain idempotent and safe to rerun without duplicate side effects.
- **RL-007**: Reconciliation MUST recompute current state at execution time if state may have changed since validation/approval.
- **RL-008**: Reconciliation MUST treat durable tenant-registry persistence as part of converged success criteria.

### Rollback Handling *(mandatory)*

- **RH-001**: If no mutation occurs before failure, system MUST report zero-change failure.
- **RH-002**: If partial mutation occurs, system MUST record per-step success/failure and provide explicit operator remediation guidance.
- **RH-003**: If organization mutation succeeds but durable registry persistence fails, system MUST report partial failure or blocked completion and provide remediation steps.
- **RH-004**: The workflow MUST fail closed on authorization, validation, or approval precondition failure.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured audit evidence for intake, validation, approval, reconciliation plan, mutation actions, registry persistence, and final status.
- **OR-002**: Required correlation fields MUST include issue number, workflow run id, requester, approver, target organization, tenant name/key, derived teams/slugs, and per-step outcome.
- **OR-003**: Human-readable step summary MUST report dry-run status, approval state, mutation/no-op decisions, registry-write result, and any remediation guidance.
- **OR-004**: Machine-readable artifact MUST include per-step outcomes and final lifecycle state for tenant bootstrap operation.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Workflow MUST minimize unnecessary API calls by reusing validated state where safe and fetching only required resources.
- **GH-002**: Retry behavior MUST be bounded and include backoff for retryable and secondary rate-limit responses.
- **GH-003**: On exhausted retry budget or non-retryable API failures, workflow MUST stop safely, preserve partial outcomes, and surface operator retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST cover valid and invalid request parsing for target organization, tenant name, dry-run, and justification fields.
- **TE-002**: Tests MUST cover tenant-name normalization, derived team-slug generation, and collision/conflict rejection behavior.
- **TE-003**: Tests MUST cover approval-gate behavior for authorized active-owner approvers and unauthorized actors.
- **TE-004**: Tests MUST cover reconciliation behavior for create path, partial-existing path, and full no-op rerun path.
- **TE-005**: Tests MUST cover hierarchy already-linked no-op and re-parent blocked outcomes.
- **TE-006**: Tests MUST cover requester maintainer bootstrap, requester promotion to maintainer, and requester-already-maintainer no-op.
- **TE-007**: Tests MUST cover missing/insufficient token failure and fail-closed behavior.
- **TE-008**: Tests MUST cover durable registry write success, update/no-op write behavior, and durable write failure partial-failure handling.
- **TE-009**: Tests MUST cover dry-run behavior to ensure no organization mutation occurs.
- **TE-010**: Tests MUST cover bounded retry and partial-failure observability under throttling/interruption.

### Key Entities *(include if feature involves data)*

- **Tenant Creation Request**: The request record containing requester, target organization, tenant name, dry-run flag, justification, approval state, validation results, and execution outcomes.
- **Derived Tenant Team Set**: The deterministic pair of team records (`TenantName_Tenant`, `TenantName_RepoAdmins`) with normalized names/slugs and reconciliation statuses.
- **Tenant Bootstrap Assignment**: The requester maintainer-assignment record for `TenantName_Tenant`, including prior role, desired role, and mutation/no-op outcome.
- **Tenant Registry Record**: Durable per-tenant file content persisted under `tenant-registry/`, including tenant identity, organization, derived teams/slugs, requester/approver metadata, lifecycle status, and run correlation identifiers.
- **Tenant Bootstrap Execution Outcome**: Structured per-step result showing validation, approval, team creation, hierarchy linkage, maintainer assignment, registry persistence, and final completion status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least 95% of valid tenant-creation submissions reach approval-ready state without manual correction on first attempt.
- **SC-002**: 100% of execution attempts without valid active-owner approval remain blocked from mutation.
- **SC-003**: 100% of reruns for already satisfied tenant bootstrap requests complete without duplicate team creation or duplicate hierarchy mutation.
- **SC-004**: For completed runs, operators can determine from summary and artifact whether each step (team create, link, maintainer assignment, registry persistence) was applied, skipped, blocked, or failed without inspecting raw API logs.
- **SC-005**: 100% of runs where durable registry persistence is unavailable are reported as blocked/partial failure rather than full success.

## Assumptions

- Requests are submitted by authenticated GitHub users through the repository issue-form flow.
- One request manages exactly one tenant for exactly one target organization.
- Tenant name is expected to be human-readable input that may require normalization before slug-based operations.
- The target organization remains the source of truth for team existence, hierarchy state, and membership role checks.
- `ISSUEOPS_GITHUB_TOKEN` is PAT-backed and can be scoped to least-privilege permissions needed for this workflow.
- Durable tenant registry persistence is expected to occur in this repository under `tenant-registry/` using automated commit/PR as the preferred mechanism.
- The `tenant-registry/` directory is pre-provisioned in the repository before runtime and is treated as an invariant input to this workflow.
- Tenant-boundary enforcement across existing other IssueOps operations is intentionally deferred to a future feature.
- Native GitHub custom roles and tenant-scoped repository/ruleset permissions are intentionally out of scope for this version.
