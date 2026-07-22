# Feature Specification: Tenant CI/CD Admin Bootstrap

**Feature Branch**: `024-create-feature-branch`  
**Created**: 2026-06-12  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for adding a third tenant sub-team during tenant bootstrap: `<TenantName>_Tenant_CICDAdmin`, preserving baseline teams `<TenantName>_Tenant` and `<TenantName>_RepoAdmins`, while safely modeling GitHub CI/CD administration constraints without unsafe org-wide privilege expansion."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

**Baseline Specification** (must not regress):
- `specs/014-create-tenant-model/spec.md` — tenant bootstrap intake, governance, reconciliation, and registry persistence behavior

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bootstrap Tenant Teams With CICDAdmin Addition (Priority: P1)

An authorized requester submits a tenant-creation request and, after valid approval, the workflow converges tenant bootstrap state by preserving existing baseline teams and adding a new third team for CI/CD administration intent.

**Why this priority**: The core value is extending tenant bootstrap safely without changing the existing tenant model behavior.

**Independent Test**: Can be fully tested by executing an approved tenant bootstrap request and verifying that the workflow derives and reconciles three teams (`<TenantName>_Tenant`, `<TenantName>_RepoAdmins`, `<TenantName>_Tenant_CICDAdmin`) while preserving baseline hierarchy and no-op behavior for pre-existing state.

**Acceptance Scenarios**:

1. **Given** a valid request and approved execution where none of the three tenant teams exist, **When** reconciliation runs, **Then** all three teams are created with deterministic names/slugs and baseline hierarchy rules are preserved.
2. **Given** an approved request where one or more required teams already exist, **When** reconciliation runs, **Then** only missing teams are created and existing teams are treated as no-op.
3. **Given** a request where CICDAdmin team hierarchy precondition conflicts with current state, **When** reconciliation runs, **Then** mutation for the conflicting hierarchy path is blocked with clear remediation guidance.

---

### User Story 2 - Apply CI/CD Admin Capability Safely Under Platform Constraints (Priority: P2)

After tenant teams are reconciled, the workflow evaluates whether tenant CI/CD admin capability can be safely represented using available organization capabilities and applies only least-privilege operations that do not introduce unauthorized organization-wide privilege expansion.

**Why this priority**: CI/CD administration can be organization-scoped in GitHub, so capability assignment must be explicitly constrained and safe.

**Independent Test**: Can be fully tested by running approved requests in two conditions: one where required org capability support is available and one where it is unavailable, and verifying deterministic applied/blocked/unavailable outcomes without unsafe escalation.

**Acceptance Scenarios**:

1. **Given** required org capability prerequisites are available and policy-approved for tenant-scoped application, **When** execution runs, **Then** tenant CI/CD admin capability is applied via the primary supported path with auditable evidence.
2. **Given** primary capability prerequisites are unavailable, **When** execution runs, **Then** the workflow follows safe fallback behavior that does not grant broad org-wide privileges and records capability as blocked or unavailable with reason codes.
3. **Given** no safe tenant-scoped CI/CD capability path exists for the org, **When** execution runs, **Then** the workflow fails closed for capability assignment and reports explicit remediation steps.

---

### User Story 3 - Preserve Baseline Governance, Idempotency, and Audit Outcomes (Priority: P3)

The enhancement preserves baseline governance from spec 014, including approval requirements, fail-closed controls, dry-run behavior, deterministic reconciliation, and durable audit/registry evidence for each step.

**Why this priority**: Non-regression and operational trust are required for adoption of this enhancement.

**Independent Test**: Can be fully tested by running dry-run and approved execution paths, including reruns and partial-failure scenarios, and verifying baseline controls remain unchanged while new CICDAdmin outcomes are fully observable.

**Acceptance Scenarios**:

1. **Given** no valid designated active target-org-owner approval exists, **When** execution is attempted, **Then** all mutating steps remain blocked.
2. **Given** dry-run mode is selected, **When** validation and reconciliation complete, **Then** the workflow emits full intended outcomes for CICDAdmin capability without mutation.
3. **Given** tenant team creation succeeds but CI/CD capability assignment cannot be safely applied, **When** execution completes, **Then** overall result is partial-failure with explicit remediation guidance and complete audit evidence.

### Edge Cases

- Tenant name normalization yields invalid or colliding CICDAdmin-derived slug.
- CICDAdmin team exists but is linked under an unexpected parent hierarchy.
- Requester is not eligible for any required bootstrap membership action in target organization context.
- Designated approver loses active owner status between validation and approval.
- Org capability endpoints for CI/CD administration are unsupported or inaccessible for the executing credential.
- Fallback path would require broad org-wide privilege expansion that violates least-privilege constraints.
- Reconciliation state changes between approval and execution (drift).
- Retry budget is exhausted during capability evaluation or assignment.
- Tenant registry persistence succeeds for baseline fields but fails for CICDAdmin capability metadata update.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST preserve all baseline behavior and constraints defined in `specs/014-create-tenant-model/spec.md` unless explicitly extended by this feature.
- **FR-002**: The system MUST derive exactly three tenant teams from tenant name input for this feature version: `<TenantName>_Tenant`, `<TenantName>_RepoAdmins`, and `<TenantName>_Tenant_CICDAdmin`.
- **FR-003**: The system MUST preserve existing baseline derivation and reconciliation behavior for `<TenantName>_Tenant` and `<TenantName>_RepoAdmins` with no regression.
- **FR-004**: The system MUST deterministically derive, normalize, and validate the `<TenantName>_Tenant_CICDAdmin` team name/slug.
- **FR-005**: The system MUST create `<TenantName>_Tenant_CICDAdmin` only when missing and MUST treat existing matching team state as no-op.
- **FR-006**: The system MUST enforce this deterministic hierarchy rule for `<TenantName>_Tenant_CICDAdmin`: it MUST be linked as a direct child of `<TenantName>_Tenant`.
- **FR-006A**: If `<TenantName>_Tenant_CICDAdmin` is already linked under `<TenantName>_Tenant`, reconciliation MUST treat hierarchy linkage as no-op.
- **FR-006B**: If `<TenantName>_Tenant_CICDAdmin` is linked under any different parent team, the workflow MUST block re-parenting in this feature version and return remediation guidance.
- **FR-006C**: When `<TenantName>_Tenant_CICDAdmin` is created or validated as linked, the workflow MUST persist the CICDAdmin relationship in tenant topology under `topology.teams.structure` with parent `<TenantName>_Tenant` and child `<TenantName>_Tenant_CICDAdmin`.
- **FR-006D**: If the CICDAdmin topology relationship entry already exists with the same parent-child pairing, topology persistence MUST be no-op.
- **FR-006E**: If topology contains a conflicting parent for CICDAdmin, the workflow MUST block mutation for this feature version and return remediation guidance.
- **FR-007**: The system MUST model tenant CI/CD admin as capability intent with explicit platform constraint evaluation before assignment.
- **FR-008**: When policy-approved primary capability prerequisites are available, the system MUST apply CI/CD admin capability through the approved primary path.
- **FR-009**: When primary path is unavailable, the system MUST use only approved least-privilege fallback behavior that does not create unauthorized org-wide privilege expansion.
- **FR-010**: If no safe tenant-scoped CI/CD admin representation can be guaranteed, the system MUST fail closed for capability assignment and record blocked or unavailable status.
- **FR-011**: The system MUST NOT grant organization-owner privilege as part of this feature.
- **FR-012**: The system MUST preserve existing dry-run behavior and emit planned CICDAdmin outcomes without mutation.
- **FR-013**: The system MUST preserve idempotent rerun behavior across team creation, hierarchy linkage, and capability assignment.
- **FR-014**: The system MUST prevent duplicate capability grants or duplicate assignment attempts on reruns.
- **FR-015**: The system MUST extend tenant-registry persistence to capture CICDAdmin team identity and capability status values: `requested`, `applied`, `skipped`, `blocked`, `unavailable`, `failed`.
- **FR-016**: The system MUST persist reason codes and evidence fields when capability is blocked, unavailable, or failed.
- **FR-017**: The system MUST emit structured step outcomes and human-readable summaries for CICDAdmin derivation, hierarchy checks, capability evaluation, capability assignment, and final status.
- **FR-018**: The system MUST NOT change repository creation behavior in this feature.
- **FR-019**: The system MUST NOT create branch, tag, or push rulesets in this feature.
- **FR-020**: The system MUST NOT introduce tenant-boundary hardening changes outside this enhancement.
- **FR-021**: The system MUST NOT grant broad org-level privileges outside explicitly approved CI/CD capability model.

### CI/CD Capability Decision Matrix *(mandatory)*

- **CDM-001 (Primary-Apply)**: If org capability prerequisites are available, policy marks the path approved, and scope can be constrained to tenant-safe boundaries, selected path MUST be `primary` and status MUST be `applied`.
- **CDM-002 (Fallback-Apply)**: If `primary` is unavailable but tenant-owned repository scope is resolvable and fallback is policy-approved without broad org-wide expansion, selected path MUST be `fallback` and status MUST be `applied`.
- **CDM-003 (Blocked-Unsafe-Scope)**: If any path requires unauthorized broad org-wide privilege expansion, selected path MUST be `none` and status MUST be `blocked` with reason code `unsafe_scope`.
- **CDM-004 (Unavailable-Capability)**: If neither primary nor fallback prerequisites are available, selected path MUST be `none` and status MUST be `unavailable` with reason code `capability_unavailable`.
- **CDM-005 (Failed-Execution)**: If a policy-approved selected path encounters non-retryable or exhausted-retry execution failure, status MUST be `failed` and include operation-specific reason code and remediation guidance.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity derivation MUST remain unchanged from `specs/014-create-tenant-model/spec.md`.
- **AR-002**: Approval requirements MUST remain unchanged: explicit approval by the designated active target-org owner is required before mutation.
- **AR-003**: Issue assignment or routing metadata MUST remain non-authorizing.
- **AR-004**: Any new privileged operation for CICDAdmin capability MUST validate actor eligibility and authorization at execution time.
- **AR-005**: Executing credential model MUST remain least privilege and fail closed when insufficient for required reads or approved mutations.

### Validation Strategy *(mandatory)*

- **VS-001**: Validation MUST preserve all baseline parsing and semantic checks from spec 014.
- **VS-002**: Validation MUST include deterministic derivation and slug validation for `<TenantName>_Tenant_CICDAdmin`.
- **VS-003**: Validation MUST check hierarchy preconditions for CICDAdmin team linkage and detect conflicts before mutation.
- **VS-003A**: Validation MUST check tenant topology structure consistency for CICDAdmin parent-child relation and detect topology conflicts before mutation.
- **VS-004**: Validation MUST evaluate CI/CD capability prerequisites for the selected primary or fallback path before mutation.
- **VS-005**: Validation MUST reject unsafe paths that imply unauthorized org-wide privilege expansion.
- **VS-006**: Validation MUST produce actionable findings and reason codes for blocked/unavailable capability outcomes.
- **VS-007**: Validation MUST support dry-run outputs that include capability intent, chosen path, and blocking conditions.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST include baseline tenant bootstrap state plus CICDAdmin team and its evaluated CI/CD capability status.
- **RL-002**: Reconciliation MUST read current organization/team/hierarchy/capability state at execution time to account for drift.
- **RL-003**: Reconciliation MUST apply only missing or changed safe state and treat already-satisfied state as no-op.
- **RL-003A**: Reconciliation MUST persist missing CICDAdmin topology structure entry under tenant parent team and treat matching existing entry as no-op.
- **RL-004**: Reconciliation MUST remain idempotent across reruns and avoid duplicate grants/assignments.
- **RL-005**: Reconciliation MUST classify CICDAdmin capability outcome as `applied`, `skipped`, `blocked`, `unavailable`, or `failed` with evidence.

### Rollback Handling *(mandatory)*

- **RH-001**: Pre-mutation validation failures MUST remain zero-change failures.
- **RH-002**: If tenant team creation succeeds but CI/CD capability assignment fails or is blocked post-approval, workflow outcome MUST be partial-failure or blocked completion with remediation guidance.
- **RH-003**: The workflow MUST fail closed on authorization, approval, validation, or safety-policy failures.

### Observability Requirements *(mandatory)*

- **OR-001**: Structured artifacts MUST include CICDAdmin team derivation, hierarchy validation, capability path decision, capability outcome, reason codes, and evidence.
- **OR-002**: Required correlation fields MUST include issue number, run id, requester, approver, tenant key/name, target organization, and per-step outcome.
- **OR-003**: Human-readable summaries MUST distinguish no-op, applied, blocked, unavailable, failed, and partial-failure outcomes for CICDAdmin capability.
- **OR-004**: Tenant-registry record updates MUST reflect CICDAdmin team identity and capability outcome status for each processed request.
- **OR-005**: Audit artifacts and summaries MUST report CICDAdmin topology persistence outcome as one of `applied`, `noop`, `blocked`, or `failed`.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The workflow MUST minimize capability-related API calls by deterministic path selection and bounded prerequisite checks.
- **GH-002**: Retry/backoff behavior MUST be bounded for retryable and secondary rate-limit responses.
- **GH-003**: On exhausted retry budget, workflow MUST stop safely, preserve intermediate outcomes, and return operator retry guidance without unsafe continuation.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST cover deterministic CICDAdmin name derivation and slug validation.
- **TE-002**: Tests MUST cover CICDAdmin create, no-op, and rerun idempotency paths.
- **TE-003**: Tests MUST cover CICDAdmin hierarchy conflict detection and blocked outcomes.
- **TE-003A**: Tests MUST cover CICDAdmin topology structure update (`topology.teams.structure`) when parent-child relation is newly created.
- **TE-003B**: Tests MUST cover topology no-op when matching CICDAdmin parent-child relation already exists.
- **TE-003C**: Tests MUST cover blocked outcome when topology has a conflicting CICDAdmin parent mapping.
- **TE-004**: Tests MUST cover capability-available path with safe successful application.
- **TE-005**: Tests MUST cover capability-unavailable path with safe blocked/unavailable outcome and reason codes.
- **TE-006**: Tests MUST cover dry-run no-mutation behavior including capability intent reporting.
- **TE-007**: Tests MUST cover partial-failure reporting and remediation guidance when team creation and capability assignment diverge.
- **TE-008**: Tests MUST cover non-regression against baseline tenant bootstrap behavior from spec 014.
- **TE-009**: Tests MUST assert this enhancement does not invoke branch/tag/push ruleset mutation paths.
- **TE-010**: Tests MUST assert this enhancement does not perform tenant-boundary hardening mutations outside the scoped CICD enhancement.
- **TE-011**: Tests MUST assert repository creation behavior remains unchanged for unaffected workflows.

### Key Entities *(include if feature involves data)*

- **TenantCicdAdminTeam**: The derived tenant sub-team `<TenantName>_Tenant_CICDAdmin` with normalized identity and reconciliation status.
- **CicdCapabilityIntent**: The requested tenant CI/CD administration intent with evaluated eligibility, chosen safe path, and final capability outcome.
- **CicdCapabilityEvidence**: Structured reason codes and evidence fields describing why capability was applied, skipped, blocked, unavailable, or failed.
- **TenantRegistryCicdExtension**: Registry extension fields capturing CICDAdmin team identity and CI/CD capability status per request lifecycle.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of baseline tenant bootstrap regression tests from spec 014 continue to pass with this enhancement enabled.
- **SC-002**: 100% of requests lacking valid designated active target-org-owner approval remain blocked from mutation.
- **SC-003**: 100% of capability evaluations that would require unauthorized broad org-wide privilege expansion are blocked.
- **SC-004**: 100% of reruns on already satisfied CICDAdmin team/capability state complete without duplicate team creation or duplicate capability assignment attempts.
- **SC-005**: For completed runs, operators can determine CICDAdmin outcome (`applied`, `skipped`, `blocked`, `unavailable`, `failed`) and rationale from summary/artifact without raw log inspection.

## Assumptions

- GitHub CI/CD administration controls can be organization-scoped and may not always support strict tenant-scoped delegation.
- Some organizations may not expose required capability APIs or policy features needed for primary CI/CD capability path.
- Approved fallback behavior may be repository-scoped for tenant-owned repositories only when it satisfies least-privilege policy constraints.
- This feature extends tenant bootstrap capability modeling only and does not redefine broader tenant-boundary enforcement strategy.
- Existing pre-provisioned `tenant-registry/` persistence invariant from spec 014 remains unchanged.
