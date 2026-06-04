# Feature Specification: Harden Create Org Teams Tenant Boundary Enforcement

**Feature Branch**: `015-harden-org-teams-tenancy`  
**Created**: 2026-05-26  
**Status**: Draft  
**Input**: User description: "Create a new enhancement specification for the create-org-teams IssueOps workflow to prevent cross-tenant mutation bugs while preserving existing behavior."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enforce Tenant Boundary at Intake (Priority: P1)

A requester submits create-org-teams requests through manual, bulk CSV, or CSV attachment intake, and the workflow enforces one canonical tenant context so that ambiguous or cross-tenant input is blocked before approval.

**Why this priority**: Blocking boundary violations before approval eliminates the highest-risk path for unintended team creation in the wrong tenant context.

**Independent Test**: Can be fully tested by submitting valid single-tenant requests and mixed-tenant or ambiguous requests across all intake modes, then verifying only single-tenant requests become approval-ready.

**Acceptance Scenarios**:

1. **Given** a request with one target organization and tenant-consistent team definitions, **When** preflight validation runs, **Then** the request is marked approval-ready with a recorded canonical tenant context.
2. **Given** a request with conflicting tenant indicators or mixed-tenant signals, **When** preflight validation runs, **Then** the request is rejected with deterministic boundary findings and no mutation eligibility.
3. **Given** a CSV-attachment request with tenant-consistent metadata but no valid requester attachment yet, **When** validation runs, **Then** the request stays waiting-for-attachment and is not approval-eligible.

---

### User Story 2 - Bind Approval to Validated Tenant Context (Priority: P2)

A designated approver grants approval in the central repository, and the workflow accepts that approval only when the approver authority and the validated tenant context match the current request state.

**Why this priority**: Approval replay or identity ambiguity can authorize cross-tenant mutation unless approval is strictly bound to validated request context.

**Independent Test**: Can be fully tested by submitting approval comments from valid and invalid identities, including stale approvals from earlier request states, and verifying only context-matching approvals unlock execution.

**Acceptance Scenarios**:

1. **Given** a request whose tenant boundary is validated and unchanged, **When** the valid approver comments the required approval signal, **Then** the request is approved for execution.
2. **Given** a request where tenant boundary inputs changed after a prior approval comment, **When** approval is re-evaluated, **Then** prior approval is invalidated and execution remains blocked until a fresh valid approval is provided.
3. **Given** an approval commenter whose authority is uncertain or no longer valid for the tenant context, **When** approval is evaluated, **Then** approval is denied and mutation stays blocked.

---

### User Story 3 - Revalidate Boundary During Execution and Audit Outcome (Priority: P3)

After approval, execution revalidates the tenant boundary against current state and applies create-only-missing reconciliation without cross-tenant mutation, while capturing structured evidence of boundary enforcement decisions.

**Why this priority**: Even valid requests can drift between validation and execution; runtime boundary revalidation is required for safe mutation.

**Independent Test**: Can be fully tested by running approved requests under unchanged and drifted conditions, including adversarial attempts, and verifying deterministic blocked outcomes when boundary checks fail.

**Acceptance Scenarios**:

1. **Given** an approved request with unchanged tenant boundary context, **When** execution runs, **Then** only missing in-scope teams are created and existing teams are no-op.
2. **Given** an approved request where boundary context no longer matches at execution time, **When** pre-mutation guardrails run, **Then** execution fails closed before mutation and records boundary mismatch evidence.
3. **Given** a rerun of an already satisfied request, **When** reconciliation executes, **Then** no duplicate side effects occur and audit evidence shows deterministic no-op outcomes.

### Edge Cases

- Manual intake provides valid organization but team names that normalize into a boundary-disallowed naming pattern.
- Bulk CSV and request metadata together imply conflicting tenant context.
- CSV attachment is valid syntactically but corresponds to a different tenant context than the issue metadata.
- Approval comment was valid before a corrected attachment changed the active request context.
- Requester identity, approver identity, or token capabilities are partially available but not sufficient to prove authority.
- Another actor creates one of the requested teams in a different tenant context between approval and execution.
- Workflow rerun occurs after labels or comments change the inferred boundary metadata.
- Rate limiting interrupts boundary checks after partial reads but before safe execution eligibility is determined.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: This enhancement MUST preserve non-regressive behavior defined in `specs/003-create-org-teams/spec.md` for valid manual requests that satisfy tenant-boundary checks.
- **FR-002**: This enhancement MUST preserve non-regressive behavior defined in `specs/007-create-org-teams-bulk-csv-mode/spec.md` for valid bulk CSV requests that satisfy tenant-boundary checks.
- **FR-003**: This enhancement MUST preserve non-regressive behavior defined in `specs/011-create-org-teams-csv-attachment/spec.md` for valid CSV attachment requests that satisfy tenant-boundary checks.
- **FR-004**: The system MUST derive one canonical tenant context from request metadata and normalized intake content before approval eligibility is granted.
- **FR-005**: The system MUST reject requests that contain mixed-tenant signals, ambiguous boundary inputs, or boundary context that cannot be computed deterministically.
- **FR-006**: The system MUST apply the same tenant-boundary enforcement semantics across manual, bulk CSV, and CSV attachment intake modes.
- **FR-007**: The system MUST keep approval and mutation blocked whenever tenant context, requester identity, approver authority, or token capability is uncertain.
- **FR-008**: The system MUST bind approval eligibility to the latest validated tenant context so that stale approvals cannot authorize execution.
- **FR-009**: The system MUST revalidate tenant boundary context immediately before mutation and fail closed on mismatch.
- **FR-010**: The system MUST continue create-only-missing reconciliation and MUST NOT mutate teams outside the validated tenant context.
- **FR-011**: The system MUST produce explicit final outcomes that distinguish boundary-blocked, validation-failed, approved, executed, partially-executed, and no-op states.
- **FR-012**: Existing out-of-scope constraints from specs 003, 007, and 011 MUST remain unchanged unless explicitly amended by this feature.

### Cross-Tenant Security Invariants

- **CTSI-001**: Every mutating decision MUST be scoped to one validated canonical tenant context.
- **CTSI-002**: No approval signal MAY authorize mutation outside the canonical tenant context validated for the current request version.
- **CTSI-003**: When tenant context cannot be proven with high confidence, the workflow MUST fail closed.
- **CTSI-004**: Intake mode differences MUST NOT create alternate authorization or mutation paths.
- **CTSI-005**: Boundary checks MUST run at validation and again at execution time to prevent drift-induced cross-tenant mutation.
- **CTSI-006**: Audit artifacts MUST always contain evidence of boundary input, derived context, enforcement decision, and resulting status.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the issue author and preserved as a required input for boundary enforcement.
- **AR-002**: Approver identity MUST be derived from the explicit approval comment and validated against the request's canonical tenant context.
- **AR-003**: A valid approver for team creation MUST satisfy existing owner and intended-owner constraints from specs 003, 007, and 011 and MUST be revalidated at approval time.
- **AR-004**: Approval MUST be denied when approver identity is ambiguous, stale relative to current validated context, or not authorized for the canonical tenant context.
- **AR-005**: Executing credential MUST continue using `ISSUEOPS_GITHUB_TOKEN` with least privilege and MUST fail closed when tenant-boundary reads or authorization checks cannot be completed.
- **AR-006**: Authorization decisions MUST be mode-neutral; manual, bulk CSV, and CSV attachment requests MUST use equivalent authority checks.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue payload and comment context MUST be parsed into structured fields before any mutation eligibility is evaluated.
- **VS-002**: Validation MUST compute canonical tenant context from target organization, intended owner model, and normalized requested teams.
- **VS-003**: Validation MUST reject mixed-tenant indicators, conflicting normalized team sets, and any boundary context that cannot be computed deterministically.
- **VS-004**: CSV attachment validation MUST require that accepted attachment content remains tenant-consistent with issue metadata and derived requested teams.
- **VS-005**: Validation MUST version or timestamp boundary context so approval can be bound to the latest successful validation state.
- **VS-006**: Validation outputs MUST clearly report boundary findings, including accepted context, rejected indicators, and blocking reason codes.
- **VS-007**: Validation MUST keep requests non-approval-ready when boundary checks, identity checks, or token capability checks are incomplete.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be derived from the validated, tenant-scoped requested team set only.
- **RL-002**: Execution MUST re-read current organization and team state relevant to the canonical tenant context before mutation.
- **RL-003**: Reconciliation MUST create only missing teams within scope and mark pre-existing in-scope teams as no-op.
- **RL-004**: If runtime boundary context differs from validated context, reconciliation MUST stop before mutation and record boundary mismatch outcome.
- **RL-005**: Reruns MUST remain idempotent and MUST NOT create duplicate teams or cross-tenant side effects.

### Rollback Handling *(mandatory)*

- **RH-001**: If boundary checks fail before mutation, the workflow MUST report zero-change blocked failure.
- **RH-002**: If partial mutation occurs due to non-boundary runtime failures, the workflow MUST record per-team outcomes and operator remediation guidance.
- **RH-003**: Boundary violations, authorization ambiguity, or token-capability uncertainty MUST trigger fail-closed behavior rather than compensating mutation attempts.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured evidence for boundary inputs, canonical tenant context derivation, boundary validation decision, approval binding decision, and execution guardrail result.
- **OR-002**: Required correlation fields MUST include issue number, run id, requester, approver, target organization, intake mode, boundary context version, and enforcement outcome.
- **OR-003**: Human-readable summaries MUST state whether the request was blocked for boundary reasons, approved with bound context, or executed within scope.
- **OR-004**: Audit artifacts MUST distinguish boundary-blocked outcomes from standard validation errors and from post-approval execution failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Boundary and authorization reads MUST minimize repeated calls by reusing safe intermediate results within one validation or execution attempt.
- **GH-002**: Retry behavior MUST be bounded and MUST preserve fail-closed behavior when boundary-critical reads cannot be completed.
- **GH-003**: If throttling prevents high-confidence boundary enforcement, the workflow MUST stop mutation and surface explicit retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify non-regression for valid flows from specs 003, 007, and 011.
- **TE-002**: Tests MUST verify canonical tenant context derivation and rejection of mixed-tenant or ambiguous inputs for all intake modes.
- **TE-003**: Tests MUST verify approval binding to latest validated boundary context and rejection of stale approval comments.
- **TE-004**: Tests MUST verify execution-time boundary revalidation blocks mutation on mismatch.
- **TE-005**: Tests MUST verify idempotent reruns with no duplicate or cross-tenant side effects.
- **TE-006**: Tests MUST include adversarial scenarios attempting cross-tenant mutation through metadata conflicts, attachment changes, and approval replay.
- **TE-007**: Tests MUST verify audit schema coverage for boundary evidence and deterministic blocked outcomes.

### Key Entities *(include if feature involves data)*

- **Tenant Boundary Context**: Canonical request-scoped context defining the only tenant scope in which mutation is allowed.
- **Boundary Validation Result**: Structured output describing accepted context, rejected indicators, confidence state, and blocking reason.
- **Bound Approval Decision**: Approval record tied to a specific validated boundary context version.
- **Boundary Enforcement Outcome**: Execution-stage evidence indicating whether runtime context matched validated context and whether mutation remained in scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid requests that comply with specs 003, 007, and 011 continue to reach equivalent approval and execution outcomes after tenant-boundary hardening.
- **SC-002**: 100% of detected mixed-tenant or ambiguous-boundary requests are blocked before mutation.
- **SC-003**: 100% of execution attempts with boundary mismatch at runtime are blocked before mutation.
- **SC-004**: 100% of approved reruns for already satisfied requests complete with no duplicate side effects.
- **SC-005**: For completed and blocked runs, reviewers can determine boundary inputs, boundary decision, and enforcement outcome from summaries and artifacts without inspecting raw API payloads.

## Assumptions

- `specs/003-create-org-teams/spec.md` remains the baseline authority for manual create-org-teams behavior not explicitly changed by this enhancement.
- `specs/007-create-org-teams-bulk-csv-mode/spec.md` remains the baseline authority for bulk CSV normalization and row-level validation semantics not explicitly changed by this enhancement.
- `specs/011-create-org-teams-csv-attachment/spec.md` remains the baseline authority for CSV attachment intake semantics not explicitly changed by this enhancement.
- This enhancement changes boundary enforcement and authorization hardening only; it does not expand scope into member population, parent-team hierarchy mutation, or multi-organization request processing.
- Current PAT-backed execution identity remains in use and must provide sufficient read and mutation capability to enforce boundary checks safely.
