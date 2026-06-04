# Feature Specification: Harden Add Child Teams Tenant Boundary Enforcement

**Feature Branch**: `017-harden-child-teams-tenancy`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: User description: "Create a new enhancement specification for the add-child-teams IssueOps workflow to prevent cross-tenant mutation bugs while preserving existing behavior."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate Tenant-Scoped Hierarchy Requests (Priority: P1)

A requester submits add-child-teams requests using manual or csv_attachment semantics, and the workflow derives one canonical tenant boundary context so mixed-tenant requests are blocked before approval.

**Why this priority**: Cross-tenant hierarchy mutation risk is best prevented before approval and execution are possible.

**Independent Test**: Submit valid single-tenant requests and conflicting-tenant requests across supported intake semantics and verify only valid requests become approval-ready.

**Acceptance Scenarios**:

1. **Given** a request with tenant-consistent organization, parent team, and child teams, **When** validation runs, **Then** canonical boundary context is recorded and the request can proceed to approval.
2. **Given** a request with mixed-tenant or ambiguous boundary indicators, **When** validation runs, **Then** the request is rejected with explicit boundary findings and no mutation eligibility.
3. **Given** a `csv_attachment` request with valid metadata but no accepted requester attachment, **When** validation runs, **Then** request status remains waiting for attachment and approval is blocked.

---

### User Story 2 - Require Context-Bound Hierarchy Approval (Priority: P2)

A designated hierarchy approver approves in the central repository, and approval is accepted only when approver authority and tenant boundary context match the latest validated request state.

**Why this priority**: Stale or replayed approvals can bypass security unless approval is bound to current validated context.

**Independent Test**: Validate approval acceptance for current context and rejection for stale, mismatched, or ambiguous approver conditions.

**Acceptance Scenarios**:

1. **Given** a validated request with unchanged boundary context, **When** the valid designated hierarchy approver approves, **Then** the request becomes eligible for execution.
2. **Given** a request whose validated context changed after correction, **When** prior approval is evaluated, **Then** that approval is invalidated and execution remains blocked until fresh approval.
3. **Given** an approval commenter with uncertain or insufficient authority for the validated context, **When** approval is evaluated, **Then** approval is denied and mutation remains blocked.

---

### User Story 3 - Revalidate Boundary at Execution and Reconcile Safely (Priority: P3)

After approval, execution revalidates tenant boundary context against current state, applies only missing in-scope parent-child links, and records boundary enforcement outcomes in audit evidence.

**Why this priority**: Hierarchy drift between validation and execution can cause unintended cross-tenant changes without execution guardrails.

**Independent Test**: Execute approved requests under unchanged and changed boundary conditions and verify deterministic blocked outcomes when boundary checks fail.

**Acceptance Scenarios**:

1. **Given** an approved request whose runtime boundary context matches validation, **When** execution runs, **Then** only missing in-scope links are applied and already-linked items are no-op.
2. **Given** an approved request whose runtime boundary context mismatches latest validated context, **When** execution begins, **Then** execution fails closed before mutation and records mismatch evidence.
3. **Given** a rerun after convergence, **When** execution runs again, **Then** no duplicate hierarchy mutations occur and outcomes remain idempotent.

### Edge Cases

- Parent team and child teams resolve to conflicting organizational contexts.
- Accepted attachment rows imply a boundary different from issue metadata.
- Correction comments supersede validated context after approval was already granted.
- Designated approver is present but authorization cannot be confirmed for all requested links.
- Token can read issue data but fails boundary-critical hierarchy reads.
- Child team relationship changes between approval and execution due to external activity.
- Concurrent requests overlap on hierarchy links across different tenant contexts.
- Rate limiting interrupts boundary revalidation before mutation decision.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This enhancement MUST preserve non-regressive behavior from `specs/004-add-child-teams/spec.md` for valid manual requests passing tenant boundary checks.
- **FR-002**: This enhancement MUST preserve non-regressive CSV normalization and row-level semantics from `specs/008-add-child-teams-bulk-csv-mode/spec.md` where applicable to current intake behavior.
- **FR-003**: This enhancement MUST preserve non-regressive attachment intake, provenance, and waiting-state semantics from `specs/012-add-child-teams-csv-attachment/spec.md`.
- **FR-004**: The system MUST compute a canonical tenant boundary context from organization, parent team, child team set, and designated approver context.
- **FR-005**: Requests with mixed-tenant indicators, ambiguous boundary derivation, or unresolved context confidence MUST be rejected before approval.
- **FR-006**: Boundary enforcement semantics MUST be equivalent across manual and csv_attachment pathways and preserve CSV semantics from existing enhancements.
- **FR-007**: Approval and execution MUST remain blocked when token capability, tenant context, or approver authority is uncertain.
- **FR-008**: Approval MUST be bound to the latest validated boundary context and invalidated when context changes.
- **FR-009**: Execution MUST revalidate boundary context immediately before mutation and fail closed on mismatch.
- **FR-010**: Reconciliation MUST remain create-missing-link only and MUST NOT mutate links outside the validated tenant scope.
- **FR-011**: Outcomes MUST distinguish boundary-blocked, validation-failed, waiting-for-attachment, approval-pending, executed, partially-executed, and no-op states.
- **FR-012**: Existing out-of-scope constraints from specs 004, 008, and 012 MUST remain unchanged unless explicitly amended by this feature.

### Cross-Tenant Security Invariants

- **CTSI-001**: Every hierarchy mutation MUST be scoped to one validated canonical tenant boundary context.
- **CTSI-002**: Approval MUST NOT authorize mutation unless it matches the latest validated request context.
- **CTSI-003**: Ambiguous identity, authorization, or boundary derivation MUST trigger fail-closed behavior.
- **CTSI-004**: Intake-mode differences MUST NOT create alternate authorization or mutation paths.
- **CTSI-005**: Boundary checks MUST execute during validation and again at execution time.
- **CTSI-006**: Audit outputs MUST capture boundary inputs, derived context, enforcement decisions, and final outcome.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from issue author and required for requester-only attachment progression.
- **AR-002**: Approver identity MUST be derived from explicit approval comments and validated as designated hierarchy approver for the full batch under current context.
- **AR-003**: Approval MUST be denied for stale, ambiguous, or context-mismatched approver conditions.
- **AR-004**: Executing credential MUST remain `ISSUEOPS_GITHUB_TOKEN` with least privilege for boundary-critical validation and hierarchy mutation.
- **AR-005**: If boundary-critical reads cannot be completed due to missing or insufficient token capability, mutation MUST remain blocked.
- **AR-006**: Authorization guarantees from specs 004, 008, and 012 MUST be preserved across supported intake pathways.

### Validation Strategy *(mandatory)*

- **VS-001**: Request payload and comment context MUST be parsed into structured hierarchy fields before mutation eligibility decisions.
- **VS-002**: Validation MUST compute canonical tenant boundary context from organization, parent team, child teams, and approver context.
- **VS-003**: Validation MUST reject mixed-tenant signals, conflicting hierarchy context, and unresolved identity mappings that could cause cross-tenant drift.
- **VS-004**: CSV attachment content MUST be validated as boundary-consistent with issue metadata before approval readiness.
- **VS-005**: Validation MUST produce a context version or equivalent marker for binding approval to latest validated state.
- **VS-006**: Validation outputs MUST include explicit boundary findings, reason codes, and confidence state.
- **VS-007**: Requests MUST remain non-approval-ready while waiting for attachment or when boundary, identity, or token-capability checks are incomplete.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be derived only from validated, tenant-scoped requested child links.
- **RL-002**: Execution MUST re-read relevant hierarchy state and confirm boundary consistency before mutation.
- **RL-003**: Reconciliation MUST apply only missing in-scope links and leave already-satisfied links as no-op.
- **RL-004**: If runtime boundary context diverges from validated context, execution MUST stop before mutation and emit boundary mismatch outcome.
- **RL-005**: Re-runs MUST remain idempotent and MUST NOT produce duplicate or cross-tenant side effects.

### Rollback Handling *(mandatory)*

- **RH-001**: If boundary checks fail before mutation, the workflow MUST report zero-change blocked failure.
- **RH-002**: If non-boundary runtime errors cause partial success, workflow MUST record per-link outcomes and operator remediation guidance.
- **RH-003**: Boundary uncertainty or authorization ambiguity MUST fail closed rather than attempt compensating mutation.

### Observability Requirements *(mandatory)*

- **OR-001**: Workflow MUST emit structured evidence for boundary inputs, derived context, approval-binding decision, and execution guardrail decision.
- **OR-002**: Required fields MUST include issue number, run id, requester, approver, organization, parent team, intake mode, boundary context version, and enforcement outcome.
- **OR-003**: Human-readable summaries MUST explicitly report boundary-blocked outcomes and stale-approval invalidation.
- **OR-004**: Audit evidence MUST distinguish boundary enforcement failures from ordinary validation or execution failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Boundary-critical reads MUST minimize unnecessary calls by reusing safe intermediate state within one run.
- **GH-002**: Retry behavior MUST be bounded and preserve fail-closed semantics when boundary-critical checks cannot complete.
- **GH-003**: If rate limiting prevents high-confidence boundary enforcement, workflow MUST stop mutation and provide explicit retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify non-regression for baseline and enhancement behavior from specs 004, 008, and 012.
- **TE-002**: Tests MUST verify deterministic rejection of mixed-tenant and ambiguous-boundary requests.
- **TE-003**: Tests MUST verify approval binding to latest validated context and invalidation of stale approvals.
- **TE-004**: Tests MUST verify execution-time boundary revalidation blocks mismatched requests before mutation.
- **TE-005**: Tests MUST verify idempotent reruns with no duplicate or cross-tenant hierarchy side effects.
- **TE-006**: Tests MUST include adversarial scenarios covering metadata conflicts, attachment correction races, and approval replay attempts.
- **TE-007**: Tests MUST verify audit schema and summaries consistently capture boundary decisions and outcomes.

### Key Entities *(include if feature involves data)*

- **Tenant Boundary Context**: Canonical request-scoped context defining permitted hierarchy mutation scope.
- **Boundary Validation Result**: Structured validation output containing accepted context, confidence, and blocking reason codes.
- **Context-Bound Approval Decision**: Approval record tied to latest validated boundary context marker.
- **Boundary Enforcement Outcome**: Execution-stage result showing context match state and mutation eligibility.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid requests conforming to specs 004, 008, and 012 continue to reach equivalent approval and execution outcomes after hardening.
- **SC-002**: 100% of mixed-tenant or ambiguous-boundary requests are blocked before mutation.
- **SC-003**: 100% of execution attempts with runtime boundary mismatch are blocked before mutation.
- **SC-004**: 100% of reruns for converged requests complete with no duplicate hierarchy side effects.
- **SC-005**: For all blocked and completed runs, reviewers can determine boundary inputs, boundary decision, and enforcement outcome from summaries and artifacts.

## Assumptions

- `specs/004-add-child-teams/spec.md` remains the baseline authority for unchanged manual add-child-teams behavior.
- `specs/008-add-child-teams-bulk-csv-mode/spec.md` remains the authority for CSV row-level normalization semantics preserved by this enhancement.
- `specs/012-add-child-teams-csv-attachment/spec.md` remains the authority for attachment intake and provenance semantics preserved by this enhancement.
- This feature scopes to tenant-boundary hardening and does not expand into unrelated permission or multi-organization workflows.
- PAT-backed execution remains the credential model and must support boundary-critical validation and authorization checks.
