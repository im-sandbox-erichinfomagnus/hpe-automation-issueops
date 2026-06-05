# Feature Specification: Tenant Repository Creation IssueOps Workflow

**Feature Branch**: `019-create-tenant-repos`  
**Created**: 2026-05-29  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for an IssueOps workflow that creates repositories in the target GitHub organization under strict tenant-boundary enforcement."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate Tenant-Scoped Repository Requests (Priority: P1)

An authorized requester submits a repository-creation request in the central administration repository, and the workflow determines one canonical tenant context using requester identity, request metadata, tenant-registry data, and live governance-team relationships before any approval or mutation can proceed.

**Why this priority**: Preventing ambiguous or cross-tenant repository creation at intake provides the most important safety control for the new workflow.

**Independent Test**: Can be fully tested by submitting valid and invalid single-repository requests and verifying that only requests with one provable tenant context become approval-ready.

**Acceptance Scenarios**:

1. **Given** a requester with one valid tenant context, a valid target organization, and a valid repository name, **When** validation runs, **Then** the workflow records the canonical tenant context, confirms requester eligibility, and marks the request approval-ready without mutating GitHub state.
2. **Given** a requester who matches no tenant-pattern maintainer context for the request, **When** validation runs, **Then** the workflow rejects the request with explicit tenant-resolution findings and no approval eligibility.
3. **Given** a requester who matches multiple tenant-pattern maintainer contexts and the request does not resolve the ambiguity deterministically, **When** validation runs, **Then** the workflow rejects the request with explicit ambiguity findings and no approval eligibility.

---

### User Story 2 - Require Context-Bound Approval for Repository Creation (Priority: P2)

A designated approver grants approval in the central repository, and the workflow accepts that approval only when approver authority and the latest validated tenant context still match the request.

**Why this priority**: Repository creation is a privileged action and must not be unlocked by stale, ambiguous, or unauthorized approval signals.

**Independent Test**: Can be fully tested by evaluating valid, stale, and unauthorized approval comments against the same request and verifying that only current context-bound approvals unlock execution.

**Acceptance Scenarios**:

1. **Given** a request with unchanged validated context and a designated approver who is currently authorized, **When** the approver submits the required approval signal, **Then** the request becomes execution-eligible.
2. **Given** a request whose tenant context or validation findings changed after an earlier approval, **When** approval is re-evaluated, **Then** prior approval is invalidated and execution remains blocked until a fresh valid approval is provided.
3. **Given** a designated approver whose authority cannot be confirmed for the current request context, **When** approval is evaluated, **Then** approval is denied and no mutation may proceed.

---

### User Story 3 - Create In-Scope Repository and Apply Tenant Governance (Priority: P3)

After valid approval, execution revalidates tenant context against current state, creates the requested repository only within the validated tenant scope, grants repository admin permission to the tenant governance team, and records durable audit and execution outcomes.

**Why this priority**: The business value is delivered only when repository creation and governance-team access converge safely without cross-tenant side effects.

**Independent Test**: Can be fully tested by running approved requests against missing, partially satisfied, and already satisfied repository states and verifying deterministic executed, no-op, blocked, and partial-failure outcomes.

**Acceptance Scenarios**:

1. **Given** an approved request whose repository does not yet exist and whose tenant governance checks still pass at execution time, **When** execution runs, **Then** the workflow creates the repository, grants admin permission to `X_RepoAdmin`, records success, and does not grant direct individual admin permission by default.
2. **Given** an approved request whose repository already exists and already grants admin permission to the validated `X_RepoAdmin` team, **When** execution runs, **Then** the workflow records a deterministic no-op outcome without duplicate mutation.
3. **Given** an approved request whose repository is created but whose governance-team permission grant or audit persistence does not complete successfully, **When** execution finishes, **Then** the workflow reports partial failure with per-step outcomes and remediation guidance.

### Edge Cases

- The requester matches no tenant-pattern team that can be accepted as the canonical `X_Tenant` for the request.
- The requester matches multiple tenant-pattern teams and neither request metadata nor registry data resolves the ambiguity deterministically.
- The tenant-registry entry is missing, malformed, stale, or conflicts with live organization state.
- The target organization in the request does not match the organization recorded in the resolved tenant-registry entry.
- `X_RepoAdmin` does not exist for the resolved tenant.
- `X_RepoAdmin` exists but is not a child of `X_Tenant`.
- The requester is a maintainer of `X_Tenant` but is not a member of `X_RepoAdmin`.
- The approver is designated in the request but is not currently authorized when approval is evaluated.
- The requested repository name normalizes to an invalid, reserved, or conflicting slug.
- The repository already exists with in-scope governance state already satisfied.
- The repository already exists but current governance state conflicts with the desired tenant-admin model for this workflow version.
- Runtime state drifts between validation and execution, causing the previously validated tenant context to become invalid.
- The executing credential cannot complete boundary-critical reads needed to prove tenant context or authorization.
- Repository creation succeeds but granting admin permission to `X_RepoAdmin` fails.
- Repository creation and permission grant succeed but durable audit or execution outcome persistence fails.
- Dry-run is requested and the workflow must emit full validation and reconciliation evidence without mutating organization state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow one requester to submit one tenant-scoped repository-creation request for one target organization and one repository per request.
- **FR-002**: The request MUST capture target organization, requested repository name, designated approver, business justification, and optional dry-run intent.
- **FR-003**: The system MUST derive one canonical tenant context for the request using requester identity, target organization, request metadata, tenant-registry data, and live governance-team relationships.
- **FR-004**: The system MUST confirm the requester is maintainer of exactly one tenant-pattern team that is valid for the request context and treat that team as `X_Tenant`.
- **FR-005**: If no valid tenant-pattern team can be matched for the requester and request context, the system MUST reject the request.
- **FR-006**: If multiple tenant-pattern team matches exist and canonical tenant context cannot be derived deterministically, the system MUST reject the request.
- **FR-007**: The system MUST treat the `tenant-registry/` data on the repository main branch as authoritative for tenant association and tenant-governance metadata required by this workflow.
- **FR-008**: The system MUST verify that the resolved tenant-registry record, request metadata, and live organization state agree on the canonical tenant context before approval eligibility is granted.
- **FR-009**: The system MUST confirm that the resolved tenant governance relationship includes an `X_RepoAdmin` team for the canonical tenant.
- **FR-010**: The system MUST confirm that `X_RepoAdmin` is currently a child of `X_Tenant`.
- **FR-011**: The system MUST verify that the requester is authorized for repository creation within the canonical tenant context.
- **FR-012**: The system MUST require the requester to be a maintainer of `X_Tenant`.
- **FR-013**: The system MUST require the requester to be a member of `X_RepoAdmin` for this workflow version.
- **FR-014**: The system MUST fail closed if requester identity, tenant context, registry lookup, governance relationship, approver authority, or token capability cannot be proven with high confidence.
- **FR-015**: Approval MUST be bound to the latest validated tenant context and MUST NOT unlock execution after request context changes.
- **FR-016**: Execution MUST revalidate the canonical tenant context immediately before any mutation.
- **FR-017**: If execution-time revalidation fails or runtime context differs from approved context, the system MUST stop before mutation and report a boundary-blocked outcome.
- **FR-018**: When all validation and approval checks pass, the system MUST create the requested repository in the validated target organization if it does not already exist.
- **FR-019**: The system MUST grant repository admin permission on the requested repository to the validated `X_RepoAdmin` team.
- **FR-020**: The system MUST NOT grant direct individual admin permission by default as part of this workflow.
- **FR-021**: If the repository already exists and already satisfies the validated tenant governance state, the system MUST record a no-op outcome.
- **FR-022**: If the repository already exists but does not satisfy the validated tenant governance state, the system MUST either reconcile only the missing in-scope governance change or fail closed when safe reconciliation cannot be proven.
- **FR-023**: The system MUST persist durable audit and execution outcome evidence for validation, approval, repository creation, governance grant, and final status as retained machine-readable workflow artifacts plus human-readable step summaries for every run.
- **FR-024**: Final request states MUST distinguish `blocked`, `validation_failed`, `awaiting_approval`, `approved`, `executed`, `no_op`, `failed_after_approved_execution`, and `partial_failure`.
- **FR-025**: The workflow MUST NOT create repositories outside the canonical tenant context or perform cross-tenant governance mutations.

### Cross-Tenant Security Invariants

- **CTSI-001**: Every repository mutation MUST be scoped to one validated canonical tenant context.
- **CTSI-002**: No approval signal MAY authorize repository creation unless it matches the latest validated tenant context.
- **CTSI-003**: Ambiguous tenant resolution, ambiguous requester authority, ambiguous approver authority, or ambiguous governance state MUST trigger fail-closed behavior.
- **CTSI-004**: Validation and execution MUST both perform tenant-boundary enforcement before mutation.
- **CTSI-005**: The tenant-registry main-branch record and live governance-team relationship MUST both agree before repository creation is allowed.
- **CTSI-006**: Audit outputs MUST capture tenant-resolution inputs, canonical context, decision rationale, and enforcement outcome.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the GitHub user who created the request in the central repository.
- **AR-002**: Approver identity MUST be derived from the GitHub user who submits the explicit approval signal on the request.
- **AR-003**: A valid approver MUST be both the designated approver for the request and currently authorized to approve repository creation for the resolved target organization.
- **AR-004**: Approval MUST be denied when approver identity is stale, ambiguous, unauthorized, or no longer valid for the latest validated tenant context.
- **AR-005**: Requester authorization MUST include confirmed maintainer status on `X_Tenant` and confirmed membership in `X_RepoAdmin` for this workflow version.
- **AR-006**: The executing credential MUST use `ISSUEOPS_GITHUB_TOKEN` with least privilege sufficient for boundary-critical reads, repository creation, team-permission mutation, and central-request updates.
- **AR-007**: If boundary-critical organization, team, membership, registry, or repository reads cannot be completed with the executing credential, mutation MUST remain blocked.
- **AR-008**: Central issue assignment or routing metadata MUST NOT authorize execution by itself.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue-form payload and relevant request context MUST be parsed into structured repository-creation fields before approval or mutation eligibility is evaluated.
- **VS-002**: Validation MUST normalize and validate the requested repository name and reject empty, invalid, reserved, or conflicting names.
- **VS-003**: Validation MUST compute canonical tenant context from requester identity, target organization, request metadata, tenant-registry lookup, tenant-pattern team matching, and live governance-team relationships.
- **VS-004**: Validation MUST confirm the requester is maintainer of exactly one valid `X_Tenant` match for the request context.
- **VS-005**: Validation MUST reject requests with zero tenant matches, multiple ambiguous tenant matches, or registry conflicts.
- **VS-006**: Validation MUST verify that `X_RepoAdmin` exists and is a child of the resolved `X_Tenant`.
- **VS-007**: Validation MUST verify requester membership in `X_RepoAdmin` before approval readiness is granted.
- **VS-008**: Validation MUST verify designated approver identity and current approval authority for the resolved organization and tenant context.
- **VS-009**: Validation MUST produce a context marker, version, or equivalent binding artifact that approval uses to prove it matches the latest validated request state.
- **VS-010**: Validation MUST support dry-run output that shows tenant resolution, governance checks, repository existence check, and intended mutation plan without changing GitHub state.
- **VS-011**: Validation outputs MUST include explicit reason codes and actionable findings for tenant mismatch, governance mismatch, membership mismatch, token-capability uncertainty, and repository-name conflicts.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as one repository existing in the validated target organization within the canonical tenant context with admin permission granted to the validated `X_RepoAdmin` team.
- **RL-002**: Execution MUST re-read the boundary-critical organization, team, membership, registry, and repository state needed to confirm the canonical tenant context before mutation.
- **RL-003**: If the repository does not exist and all execution-time checks pass, reconciliation MUST create the repository and then grant admin permission to `X_RepoAdmin`.
- **RL-004**: If the repository already exists and already grants admin permission to `X_RepoAdmin`, reconciliation MUST record deterministic no-op.
- **RL-005**: If the repository exists but lacks only the validated in-scope governance grant, reconciliation MAY apply only that missing tenant-scoped grant.
- **RL-006**: If the repository exists in a state that cannot be safely reconciled within the canonical tenant context, execution MUST fail closed before unsupported mutation.
- **RL-007**: Re-runs MUST remain idempotent and MUST NOT create duplicate repositories or duplicate team-permission side effects.
- **RL-008**: Audit and execution-outcome persistence MUST be treated as part of the converged workflow outcome and reported explicitly when incomplete.

### Rollback Handling *(mandatory)*

- **RH-001**: If validation, approval, or execution-time boundary checks fail before mutation, the workflow MUST report a zero-change blocked result.
- **RH-002**: If repository creation fails before the repository exists, the workflow MUST report failed execution with no successful mutation.
- **RH-003**: If repository creation succeeds but the `X_RepoAdmin` admin grant fails, the workflow MUST report partial failure and capture repository-created and grant-failed evidence separately.
- **RH-004**: If audit persistence fails after otherwise successful mutation, the workflow MUST report partial failure rather than full success.
- **RH-005**: The workflow MUST fail closed rather than attempt compensating or broad cleanup mutations when boundary confidence or authorization certainty is lost.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured audit evidence for tenant resolution, requester authorization, approver authorization, repository existence checks, mutation decisions, governance grant outcome, and final status.
- **OR-002**: Required correlation fields MUST include issue number, workflow run id, requester, approver, target organization, requested repository, canonical tenant identifier, `X_Tenant`, `X_RepoAdmin`, context-binding marker, and per-step outcome.
- **OR-003**: Human-readable step summaries MUST explicitly report tenant-resolution decisions, approval-binding decisions, dry-run results, mutation or no-op decisions, artifact-persistence results, and remediation guidance for blocked or partial-failure outcomes.
- **OR-004**: Machine-readable artifacts MUST be uploaded and retained according to repository workflow artifact retention policy and MUST distinguish tenant-boundary failures from ordinary validation failures and from post-approval execution failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Boundary-critical reads MUST minimize repeated calls by reusing safe intermediate state within a single validation or execution attempt.
- **GH-002**: Retry behavior MUST be bounded and include backoff for retryable and secondary rate-limit responses.
- **GH-003**: If rate limiting or API interruption prevents high-confidence tenant-boundary enforcement, the workflow MUST stop mutation and provide explicit retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST cover valid and invalid request parsing for target organization, repository name, designated approver, dry-run intent, and justification.
- **TE-002**: Tests MUST cover canonical tenant-resolution behavior for exactly one valid tenant match, no tenant match, and ambiguous multiple-tenant match scenarios.
- **TE-003**: Tests MUST cover tenant-registry missing, malformed, stale, and conflicting-state scenarios.
- **TE-004**: Tests MUST cover governance validation for missing `X_RepoAdmin`, incorrect parent-child relationship, and requester membership mismatch.
- **TE-005**: Tests MUST cover approval binding to the latest validated context and rejection of stale or unauthorized approvals.
- **TE-006**: Tests MUST cover execution-time tenant-boundary revalidation and blocked outcomes when runtime drift occurs.
- **TE-007**: Tests MUST cover repository creation, existing-repository no-op, and missing-governance-grant reconciliation behavior.
- **TE-008**: Tests MUST cover partial-failure outcomes when repository creation, governance grant, and audit persistence succeed or fail independently.
- **TE-009**: Tests MUST cover dry-run behavior to ensure no repository or permission mutation occurs.
- **TE-010**: Tests MUST cover bounded retry behavior and fail-closed outcomes when boundary-critical reads are throttled or interrupted.

### Key Entities *(include if feature involves data)*

- **Tenant Repository Creation Request**: The request record containing requester, target organization, requested repository name, designated approver, validation findings, approval state, and execution outcomes.
- **Canonical Tenant Context**: The resolved tenant-scoped decision object that binds requester identity, target organization, tenant-registry record, `X_Tenant`, `X_RepoAdmin`, and governance relationship into one permitted mutation scope.
- **Tenant Governance Validation Result**: The structured result that records tenant-pattern team matching, registry resolution, governance relationship checks, requester eligibility, and blocking reason codes.
- **Repository Creation Reconciliation Outcome**: The per-step outcome describing repository existence status, repository creation result, `X_RepoAdmin` admin grant result, audit persistence result, and final workflow state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of requests with no provable canonical tenant context are blocked before approval.
- **SC-002**: 100% of execution attempts with runtime tenant-context mismatch are blocked before mutation.
- **SC-003**: 100% of successful completed runs grant repository admin permission to the validated `X_RepoAdmin` team and do not add direct individual admin permission by default.
- **SC-004**: 100% of reruns for already satisfied requests complete without duplicate repository creation or duplicate governance-team grants.
- **SC-005**: For blocked, successful, and partial-failure runs, reviewers can determine tenant context, authorization decision, mutation decision, and final outcome from summaries and artifacts without inspecting raw API payloads.

## Assumptions

- Requests are submitted by authenticated GitHub users through the central repository issue-form flow.
- One request manages exactly one repository for exactly one target organization in the first version of this workflow.
- The tenant team naming model established by the tenant bootstrap feature remains the source of truth for identifying `X_Tenant` and `X_RepoAdmin` candidates.
- The `tenant-registry/` directory on the repository main branch is available as authoritative tenant-association input for validation and execution.
- Live organization state remains the source of truth for current team hierarchy, membership, repository existence, and approver authority.
- `ISSUEOPS_GITHUB_TOKEN` is PAT-backed and has sufficient least-privilege permissions to complete required reads and allowed mutations for this workflow.
- Repository-standard implementation is expected to use one issue template, one workflow shim, shared workflow-support modules, execution scripts, and targeted contract and integration tests in the standard repository surfaces.
- This version does not grant direct individual repository admin as part of successful execution.
- This version preserves fail-closed behavior when tenant context, governance relationship, or authorization certainty cannot be proven.
