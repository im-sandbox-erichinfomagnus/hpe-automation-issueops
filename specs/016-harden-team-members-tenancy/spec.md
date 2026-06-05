# Feature Specification: Harden Add Team Members Tenant Boundary Enforcement

**Feature Branch**: `016-harden-team-members-tenancy`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: User description: "Create a new enhancement specification for the add-team-members IssueOps workflow to prevent cross-tenant mutation bugs while preserving existing behavior."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate Tenant-Bound Membership Requests (Priority: P1)

A requester submits add-team-members requests through manual or csv_attachment intake semantics, and the workflow computes one canonical tenant context so mixed-tenant or ambiguous requests are blocked before approval.

**Why this priority**: Cross-tenant mutation risk is best contained by deterministic boundary checks before approval or execution can begin.

**Independent Test**: Can be fully tested by submitting valid single-tenant requests and mixed-tenant attempts for manual and csv_attachment pathways, then verifying only valid single-tenant requests become approval-ready.

**Acceptance Scenarios**:

1. **Given** a request with consistent tenant boundary signals, **When** validation completes, **Then** the request is marked approval-ready with recorded boundary context.
2. **Given** a request with conflicting tenant indicators or ambiguous team-to-organization context, **When** validation completes, **Then** the request is rejected with explicit boundary findings and no mutation eligibility.
3. **Given** a `csv_attachment` request with valid metadata but no accepted requester attachment yet, **When** validation runs, **Then** the request remains waiting-for-attachment and cannot be approved.

---

### User Story 2 - Bind Approval to Latest Tenant Context (Priority: P2)

An organization owner approves a request in the central repository, and the workflow accepts that approval only when approver authority and tenant boundary context match the latest validated request state.

**Why this priority**: Approval replay or stale approvals after request corrections can silently permit cross-tenant mutation unless context binding is enforced.

**Independent Test**: Can be fully tested by providing valid approvals, stale approvals, and unauthorized approvals and verifying that only current context-matching approvals unlock execution.

**Acceptance Scenarios**:

1. **Given** a validated request whose boundary context is unchanged, **When** a valid organization owner provides approval, **Then** the request becomes execution-eligible.
2. **Given** a request where attachment correction or metadata change updates the validated boundary context, **When** prior approval is evaluated, **Then** prior approval is invalidated and execution stays blocked until fresh approval is provided.
3. **Given** an approval commenter with uncertain or insufficient authority, **When** approval is evaluated, **Then** approval is denied and mutation remains blocked.

---

### User Story 3 - Revalidate Boundary at Execution and Reconcile Safely (Priority: P3)

After approval, execution revalidates tenant boundary context against current state, adds only missing in-scope members, and records boundary enforcement outcomes in audit evidence.

**Why this priority**: State can drift between validation and execution, so execution guardrails are required to prevent cross-tenant side effects.

**Independent Test**: Can be fully tested by executing approved requests under unchanged and changed boundary conditions, including adversarial cases, and verifying deterministic blocked outcomes when boundary checks fail.

**Acceptance Scenarios**:

1. **Given** an approved request with matching runtime boundary context, **When** execution runs, **Then** only missing in-scope memberships are added and existing members are no-op.
2. **Given** an approved request where runtime boundary context mismatches validated context, **When** pre-mutation guardrails run, **Then** execution fails closed before mutation and records boundary mismatch evidence.
3. **Given** reruns of an already converged request, **When** execution runs again, **Then** no duplicate side effects occur and outcomes remain idempotent.

### Edge Cases

- Manual request includes users that resolve to identities outside the intended tenant boundary.
- Accepted CSV attachment content is syntactically valid but implies a different tenant context than issue metadata.
- Request corrections in later comments invalidate previously valid approvals.
- Approval author is an organization owner in a different context but not valid for the request's tenant boundary.
- Token can read issue state but cannot complete tenant-critical authorization reads.
- Team exists at validation time but is moved, renamed, or access-constrained before execution.
- Concurrent requests attempt to mutate memberships for overlapping teams across different tenant contexts.
- Rate limiting interrupts boundary revalidation after partial reads and before mutation decision.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This enhancement MUST preserve non-regressive behavior from `specs/001-add-team-members/spec.md` for valid manual requests that satisfy tenant boundary checks.
- **FR-002**: This enhancement MUST preserve non-regressive behavior from `specs/006-add-team-members-bulk-csv-mode/spec.md` for CSV normalization and row-level validation semantics where those semantics are still applicable to current intake behavior.
- **FR-003**: This enhancement MUST preserve non-regressive behavior from `specs/010-team-members-csv-attachment/spec.md` for requester-authored attachment intake, provenance, and waiting-state behavior.
- **FR-004**: The system MUST derive one canonical tenant boundary context from request metadata, validated target organization/team context, and normalized requested identities.
- **FR-005**: The system MUST reject requests with mixed-tenant signals, ambiguous boundary derivation, or unresolved context confidence.
- **FR-006**: The system MUST apply equivalent boundary enforcement semantics across manual and csv_attachment pathways, including preserved CSV semantics from prior enhancements.
- **FR-007**: The system MUST keep approval and mutation blocked whenever tenant context, requester identity, approver authority, or token capability is uncertain.
- **FR-008**: The system MUST bind approval to the latest validated boundary context and invalidate stale approvals when request context changes.
- **FR-009**: The system MUST revalidate tenant boundary context immediately before mutation and fail closed on mismatch.
- **FR-010**: The system MUST continue reconciliation-first behavior by adding only missing in-scope members and preserving no-op outcomes for already satisfied memberships.
- **FR-011**: The system MUST preserve clear final outcomes distinguishing boundary-blocked, validation-failed, approval-pending, executed, partially-executed, failed, and no-op states.
- **FR-012**: Existing out-of-scope constraints in specs 001, 006, and 010 MUST remain unchanged unless explicitly amended by this feature.

### Cross-Tenant Security Invariants

- **CTSI-001**: Every mutating operation MUST be scoped to one validated canonical tenant boundary context.
- **CTSI-002**: Approval comments MUST NOT authorize mutation unless they match the latest validated request context.
- **CTSI-003**: Ambiguous requester identity, approver authority, token capability, or boundary derivation MUST result in fail-closed behavior.
- **CTSI-004**: Intake mode differences MUST NOT create alternate bypass paths for authorization or mutation.
- **CTSI-005**: Boundary checks MUST run both during validation and immediately before execution.
- **CTSI-006**: Audit outputs MUST record boundary inputs, derived context, decision rationale, and enforcement result for every run.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the issue author and required for attachment acceptance and boundary enforcement.
- **AR-002**: Approver identity MUST be derived from explicit approval comments and verified as a valid organization owner under the request's canonical tenant boundary.
- **AR-003**: Approval MUST be denied when approver authority is stale, ambiguous, or inconsistent with the latest validated context.
- **AR-004**: Executing credential MUST continue to use `ISSUEOPS_GITHUB_TOKEN` with least privilege sufficient for boundary-critical reads and membership mutation.
- **AR-005**: If boundary-critical authorization reads fail due to missing or insufficient token capabilities, execution MUST remain blocked.
- **AR-006**: Authorization policies MUST remain equivalent across intake modes and preserve safeguards from specs 001, 006, and 010.

### Validation Strategy *(mandatory)*

- **VS-001**: Request payload and comment context MUST be parsed into structured fields before any mutation decision is possible.
- **VS-002**: Validation MUST compute canonical tenant boundary context from organization, team, requester context, and normalized user set.
- **VS-003**: Validation MUST reject mixed-tenant indicators, conflicting context hints, and unresolved identity mappings that could cause cross-tenant drift.
- **VS-004**: For csv_attachment requests, accepted attachment content MUST be tenant-consistent with request metadata and target team context.
- **VS-005**: Validation MUST produce a context version or equivalent state marker so approval can be bound to the latest validated state.
- **VS-006**: Validation results MUST include explicit boundary findings, blocking reason codes, and confidence status.
- **VS-007**: Validation MUST keep requests non-approval-ready when boundary checks, identity checks, or token capability checks are incomplete.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be derived only from the validated, tenant-scoped requested membership set.
- **RL-002**: Execution MUST re-read target team and membership state before mutation and confirm boundary consistency.
- **RL-003**: Reconciliation MUST add only missing in-scope users and leave existing in-scope memberships unchanged as no-op.
- **RL-004**: If runtime boundary context differs from validated context, reconciliation MUST stop before mutation and emit boundary mismatch outcome.
- **RL-005**: Re-runs MUST remain idempotent and MUST NOT create duplicate memberships or cross-tenant side effects.

### Rollback Handling *(mandatory)*

- **RH-001**: If boundary checks fail before mutation, the workflow MUST report zero-change blocked failure.
- **RH-002**: If non-boundary runtime failures cause partial success, the workflow MUST record per-user mutation outcomes and remediation guidance.
- **RH-003**: Boundary uncertainty or authorization ambiguity MUST trigger fail-closed behavior rather than compensating mutation attempts.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured evidence for boundary inputs, derived canonical context, approval-context binding decision, and execution guardrail decision.
- **OR-002**: Required fields MUST include issue number, run id, requester, approver, target organization, target team, intake mode, boundary context version, and enforcement outcome.
- **OR-003**: Human-readable summaries MUST explicitly report boundary-blocked outcomes, stale approval invalidation, and in-scope execution outcomes.
- **OR-004**: Audit evidence MUST distinguish boundary enforcement failures from generic validation or execution failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Boundary-critical reads MUST minimize unnecessary calls by reusing safe intermediate state within one run.
- **GH-002**: Retry behavior MUST be bounded and preserve fail-closed semantics when boundary-critical reads cannot complete.
- **GH-003**: If rate limiting prevents high-confidence boundary enforcement, the workflow MUST stop mutation and provide explicit retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify non-regression for baseline and enhancement behavior from specs 001, 006, and 010.
- **TE-002**: Tests MUST verify canonical boundary derivation and deterministic rejection of mixed-tenant or ambiguous requests.
- **TE-003**: Tests MUST verify approval binding to latest validated context and invalidation of stale approvals.
- **TE-004**: Tests MUST verify execution-time boundary revalidation blocks mutation on mismatch.
- **TE-005**: Tests MUST verify idempotent reruns with no duplicate or cross-tenant side effects.
- **TE-006**: Tests MUST include adversarial cases covering metadata conflicts, attachment correction races, and approval replay attempts.
- **TE-007**: Tests MUST verify audit schema and summaries always capture tenant boundary decisions and outcomes.

### Key Entities *(include if feature involves data)*

- **Tenant Boundary Context**: Canonical per-request scope defining where membership mutation is allowed.
- **Boundary Validation Result**: Structured validation output with accepted context, confidence, and blocking reason codes.
- **Context-Bound Approval Decision**: Approval record tied to the latest validated boundary context version.
- **Boundary Enforcement Outcome**: Execution-stage evidence showing boundary match status and mutation eligibility decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid requests conforming to specs 001, 006, and 010 continue to reach equivalent approval and execution outcomes after this enhancement.
- **SC-002**: 100% of mixed-tenant or ambiguous-boundary requests are blocked before mutation.
- **SC-003**: 100% of execution attempts with boundary mismatch at runtime are blocked before mutation.
- **SC-004**: 100% of reruns for converged requests complete with no duplicate side effects.
- **SC-005**: For all blocked and completed runs, reviewers can determine boundary inputs, boundary decision, and enforcement outcome from artifacts and summaries without raw API logs.

## Assumptions

- `specs/001-add-team-members/spec.md` remains the baseline authority for unchanged manual add-team-members behavior.
- `specs/006-add-team-members-bulk-csv-mode/spec.md` remains the authority for CSV normalization and row-level validation semantics that this enhancement preserves.
- `specs/010-team-members-csv-attachment/spec.md` remains the authority for attachment intake, provenance, and waiting-state semantics that this enhancement preserves.
- This enhancement focuses on tenant-boundary hardening and does not expand scope into unrelated permission models or multi-organization request patterns.
- PAT-backed execution remains the credential model and must support boundary-critical validation and authorization checks.
