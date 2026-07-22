# Feature Specification: Harden Add Team Repo Access Tenant Boundary Enforcement

**Feature Branch**: `018-harden-repo-access-tenancy`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: User description: "Create a new enhancement specification for the add-team-repo-access IssueOps workflow to prevent cross-tenant mutation bugs while preserving existing behavior."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate Tenant-Scoped Repo Access Requests (Priority: P1)

A requester submits add-team-repo-access requests via manual or csv_attachment semantics, and the workflow computes a canonical tenant boundary context so mixed-tenant or ambiguous requests are blocked before approval.

**Why this priority**: Preventing cross-tenant permission mutations at validation time provides the strongest early safety control.

**Independent Test**: Submit valid single-tenant requests and mixed-tenant attempts across supported intake semantics and verify only valid requests become approval-ready.

**Acceptance Scenarios**:

1. **Given** a request with tenant-consistent organization, team, repositories, and permission intent, **When** validation runs, **Then** canonical boundary context is recorded and request can proceed to approval.
2. **Given** a request with mixed-tenant indicators or ambiguous boundary derivation, **When** validation runs, **Then** the request is rejected with explicit boundary findings and no mutation eligibility.
3. **Given** a `csv_attachment` request with valid metadata but no accepted requester attachment yet, **When** validation runs, **Then** the request remains waiting-for-attachment and approval stays blocked.

---

### User Story 2 - Require Context-Bound Approval for Repo Access (Priority: P2)

A designated active target-organization owner approves in the central repository, and approval is accepted only when identity, authority, and tenant boundary context match the latest validated request state.

**Why this priority**: Approval replay or stale approvals can authorize unintended cross-tenant grants without context binding.

**Independent Test**: Verify approval acceptance for current context and rejection for stale, ambiguous, or unauthorized approver conditions.

**Acceptance Scenarios**:

1. **Given** a validated request with unchanged context, **When** the valid designated owner approves, **Then** request becomes execution-eligible.
2. **Given** request context changes after correction, **When** prior approval is re-evaluated, **Then** prior approval is invalidated and execution remains blocked until fresh approval.
3. **Given** an approval commenter with uncertain or insufficient authority, **When** approval is evaluated, **Then** approval is denied and mutation remains blocked.

---

### User Story 3 - Revalidate Boundary at Execution and Reconcile Safely (Priority: P3)

After approval, execution revalidates tenant boundary context against current state, grants only missing in-scope repo access, and records boundary enforcement outcomes in durable audit evidence.

**Why this priority**: Target state can drift between validation and execution, so runtime boundary checks are needed to prevent cross-tenant permission changes.

**Independent Test**: Execute approved requests under unchanged and changed boundary conditions and verify deterministic blocked outcomes when boundary checks fail.

**Acceptance Scenarios**:

1. **Given** approved request with matching runtime boundary context, **When** execution runs, **Then** only missing in-scope grants are applied and already-satisfied repos remain no-op.
2. **Given** approved request with runtime boundary mismatch, **When** execution begins, **Then** execution fails closed before mutation and records mismatch evidence.
3. **Given** rerun after convergence, **When** execution runs again, **Then** no duplicate grants occur and idempotent no-op outcomes are reported.

### Edge Cases

- Repositories resolve to a different organizational context than request metadata.
- Attachment rows are syntactically valid but imply a different tenant boundary than issue metadata.
- A corrected attachment supersedes validated context after approval was granted.
- Approver appears valid in central repo but cannot be confirmed as active owner for current context.
- Token can read issue data but fails boundary-critical repository/team visibility reads.
- Repository state changes between approval and execution due to external changes.
- Concurrent requests overlap on repo grants across different tenant contexts.
- Rate limiting interrupts boundary revalidation before mutation eligibility decision.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This enhancement MUST preserve non-regressive behavior from `specs/005-add-team-repo-access/spec.md` for valid manual requests passing tenant boundary checks.
- **FR-002**: This enhancement MUST preserve non-regressive CSV row-level semantics from `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` where applicable to current intake behavior.
- **FR-003**: This enhancement MUST preserve non-regressive attachment intake and provenance semantics from `specs/013-add-team-repo-access-csv-attachment/spec.md`.
- **FR-004**: The system MUST compute one canonical tenant boundary context from organization, team, repositories, permission intent, and approver context.
- **FR-005**: Requests with mixed-tenant signals, ambiguous boundary derivation, or unresolved context confidence MUST be rejected before approval.
- **FR-006**: Boundary enforcement semantics MUST be equivalent across manual and csv_attachment pathways while preserving established CSV semantics.
- **FR-007**: Approval and execution MUST remain blocked when token capability, tenant context, or approver authority is uncertain.
- **FR-008**: Approval MUST be bound to latest validated boundary context and invalidated when context changes.
- **FR-009**: Execution MUST revalidate boundary context immediately before mutation and fail closed on mismatch.
- **FR-010**: Reconciliation MUST remain grant-missing-only and MUST NOT mutate permissions outside validated tenant scope.
- **FR-011**: Outcomes MUST distinguish boundary-blocked, validation-failed, waiting-for-attachment, approval-pending, executed, partially-executed, failed-after-approved-execution, and no-op states.
- **FR-012**: Existing out-of-scope constraints from specs 005, 009, and 013 MUST remain unchanged unless explicitly amended by this feature.

### Cross-Tenant Security Invariants

- **CTSI-001**: Every repository-access mutation MUST be scoped to one validated canonical tenant boundary context.
- **CTSI-002**: Approval MUST NOT authorize mutation unless it matches latest validated request context.
- **CTSI-003**: Ambiguous identity, authorization, token capability, or boundary derivation MUST trigger fail-closed behavior.
- **CTSI-004**: Intake-mode differences MUST NOT create alternate authorization or mutation paths.
- **CTSI-005**: Boundary checks MUST execute at validation and immediately before execution.
- **CTSI-006**: Audit outputs MUST capture boundary inputs, derived context, decision rationale, and enforcement outcome.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from issue author and required for requester-only attachment progression.
- **AR-002**: Approver identity MUST be derived from explicit approval comments and verified as designated active target-org owner for the full batch.
- **AR-003**: Approval MUST be denied for stale, ambiguous, or context-mismatched approver conditions.
- **AR-004**: Executing credential MUST remain `ISSUEOPS_GITHUB_TOKEN` with least privilege for boundary-critical validation and repo-access mutation.
- **AR-005**: If boundary-critical reads cannot complete due to missing or insufficient token capability, mutation MUST remain blocked.
- **AR-006**: Authorization guarantees from specs 005, 009, and 013 MUST be preserved across supported intake pathways.

### Validation Strategy *(mandatory)*

- **VS-001**: Parse request payload and comment context into structured repo-access fields before mutation eligibility decisions.
- **VS-002**: Compute canonical tenant boundary context from organization, target team, requested repositories, permission level, and approver context.
- **VS-003**: Reject mixed-tenant signals, conflicting context hints, and unresolved mappings that could cause cross-tenant drift.
- **VS-004**: For csv_attachment requests, validate accepted attachment content as boundary-consistent with issue metadata before approval readiness.
- **VS-005**: Produce context version or equivalent marker used to bind approval to latest validated state.
- **VS-006**: Validation outputs MUST include boundary findings, reason codes, and confidence state.
- **VS-007**: Requests remain non-approval-ready while waiting for attachment or when boundary, identity, or token-capability checks are incomplete.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be derived only from validated tenant-scoped requested repository grants.
- **RL-002**: Execution MUST re-read relevant repository-team permission state and confirm boundary consistency before mutation.
- **RL-003**: Apply only missing eligible grants and preserve no-op behavior for already-satisfied repositories.
- **RL-004**: If runtime boundary context diverges from validated context, execution MUST stop before mutation and emit boundary mismatch outcome.
- **RL-005**: Re-runs MUST remain idempotent and MUST NOT produce duplicate or cross-tenant side effects.

### Rollback Handling *(mandatory)*

- **RH-001**: If boundary checks fail before mutation, workflow MUST report zero-change blocked failure.
- **RH-002**: If non-boundary runtime errors cause partial success, workflow MUST record per-repository outcomes and operator remediation guidance.
- **RH-003**: Boundary uncertainty or authorization ambiguity MUST fail closed rather than attempt compensating mutation.

### Observability Requirements *(mandatory)*

- **OR-001**: Emit structured evidence for boundary inputs, derived context, approval-binding decision, and execution guardrail result.
- **OR-002**: Required fields MUST include issue number, run id, requester, approver, organization, target team, requested permission, intake mode, boundary context marker, and enforcement outcome.
- **OR-003**: Human-readable summaries MUST explicitly report boundary-blocked outcomes and stale-approval invalidation.
- **OR-004**: Audit outputs MUST distinguish boundary enforcement failures from ordinary validation or execution failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Boundary-critical reads MUST minimize unnecessary calls by reusing safe intermediate state within one run.
- **GH-002**: Retry behavior MUST be bounded and preserve fail-closed semantics when boundary-critical checks cannot complete.
- **GH-003**: If rate limiting prevents high-confidence boundary enforcement, workflow MUST stop mutation and provide explicit retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify non-regression for baseline and enhancement behavior from specs 005, 009, and 013.
- **TE-002**: Tests MUST verify deterministic rejection of mixed-tenant and ambiguous-boundary requests.
- **TE-003**: Tests MUST verify approval binding to latest validated context and invalidation of stale approvals.
- **TE-004**: Tests MUST verify execution-time boundary revalidation blocks mismatched requests before mutation.
- **TE-005**: Tests MUST verify idempotent reruns with no duplicate or cross-tenant repo-access side effects.
- **TE-006**: Tests MUST include adversarial scenarios covering metadata conflicts, attachment correction races, and approval replay attempts.
- **TE-007**: Tests MUST verify audit schema and summaries capture boundary decisions and outcomes consistently.

### Key Entities *(include if feature involves data)*

- **Tenant Boundary Context**: Canonical request-scoped context defining permitted repository-access mutation scope.
- **Boundary Validation Result**: Structured validation output containing accepted context, confidence, and blocking reason codes.
- **Context-Bound Approval Decision**: Approval record tied to latest validated boundary context marker.
- **Boundary Enforcement Outcome**: Execution-stage result showing boundary match status and mutation eligibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid requests conforming to specs 005, 009, and 013 continue to reach equivalent approval and execution outcomes after hardening.
- **SC-002**: 100% of mixed-tenant or ambiguous-boundary requests are blocked before mutation.
- **SC-003**: 100% of execution attempts with runtime boundary mismatch are blocked before mutation.
- **SC-004**: 100% of reruns for converged requests complete with no duplicate repo-access side effects.
- **SC-005**: For blocked and completed runs, reviewers can determine boundary inputs, boundary decision, and enforcement outcome from summaries and artifacts.

## Assumptions

- `specs/005-add-team-repo-access/spec.md` remains baseline authority for unchanged manual add-team-repo-access behavior.
- `specs/009-add-team-repo-access-bulk-csv-mode/spec.md` remains authority for preserved CSV row-level semantics.
- `specs/013-add-team-repo-access-csv-attachment/spec.md` remains authority for attachment intake and provenance semantics.
- This enhancement scopes to tenant-boundary hardening and does not expand into unrelated permission models or multi-organization workflows.
- PAT-backed execution remains the credential model and must support boundary-critical validation and authorization checks.
