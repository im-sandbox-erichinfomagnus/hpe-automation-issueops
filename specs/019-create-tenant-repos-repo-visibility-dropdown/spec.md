# Feature Specification: Tenant Repository Visibility Dropdown

**Feature Branch**: `019-create-tenant-repos-repo-visibility-dropdown`  
**Created**: 2026-06-04  
**Status**: Draft  
**Input**: User description: "Create a detailed IssueOps specification for a new enhancement in folder `019-create-tenant-repos-repo-visibility-dropdown`. The enhancement adds a repository visibility dropdown to the tenant repository creation flow so users can choose visibility when creating a repo. The dropdown should include repository visibility options and default to `private`. Include:
- UX behavior and dropdown labels
- request parsing and data model changes
- validation rules
- workflow handling for repo creation
- tests and contract coverage
- any expected schema or output changes"

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select Repository Visibility When Creating Tenant Repos (Priority: P1)

A requester opens the tenant repository creation issue form, selects a repository visibility from a dropdown, and submits the request with all required repository creation fields.

**Why this priority**: This enhancement directly improves the tenant repository creation experience by making repository visibility explicit and reducing post-creation corrections.

**Independent Test**: Can be fully tested by submitting a valid create-repo request with each supported visibility value and verifying that the parsed request records the chosen visibility and the workflow creates the repository with that visibility.

**Acceptance Scenarios**:

1. **Given** a requester opens the tenant repository creation form, **When** the requester selects `private` from the visibility dropdown and submits the request, **Then** the request is parsed with `repository_visibility = private` and the created repository is private.
2. **Given** a requester does not explicitly select visibility in the form, **When** the request is submitted, **Then** the request is parsed with `repository_visibility = private` by default.
3. **Given** a requester selects `public` or `internal` from the visibility dropdown and submits the request, **Then** the request is parsed with the selected visibility value and the workflow applies that visibility when creating the repository.

---

### User Story 2 - Reject Invalid Visibility Selections Early (Priority: P2)

A requester attempts to submit a repository creation request with an invalid visibility value, and the workflow rejects the request with a clear failure before any repository mutation is attempted.

**Why this priority**: Preventing invalid visibility values early keeps request validation reliable and reduces unexpected repository creation behavior.

**Independent Test**: Can be fully tested by submitting a malformed or unsupported visibility value in a request fixture and confirming validation fails with an explicit invalid-visibility finding.

**Acceptance Scenarios**:

1. **Given** a request contains a visibility value outside the allowed set, **When** validation runs, **Then** the request is rejected and the response includes a validation finding that the visibility is invalid.
2. **Given** a request contains an unsupported or empty visibility field, **When** validation runs, **Then** the request either defaults to `private` (if absent) or is rejected if the explicit value is invalid.

---

### User Story 3 - Preserve Intended Visibility in Workflow Execution (Priority: P3)

After approval, execution creates the requested repository using the visibility selected in the original request and records the requested visibility in the audit output.

**Why this priority**: Visibility is a core repository property and must be applied correctly when the repository is created.

**Independent Test**: Can be fully tested by approving a create-repo request with each supported visibility setting, running execution, and verifying the created repository visibility and audit summary reflect the requested value.

**Acceptance Scenarios**:

1. **Given** a request is approved and the repository does not exist, **When** execution runs, **Then** the workflow creates the repository with the requested visibility and records the chosen visibility in the audit artifact.
2. **Given** a request is approved and the repository already exists with matching visibility, **When** execution runs, **Then** the workflow records a deterministic no-op outcome and confirms the repository visibility already matches the requested value.
3. **Given** a request is approved and the repository already exists with differing visibility, **When** execution runs, **Then** the workflow reports a conflict or blocked outcome and does not silently change visibility.

### Edge Cases

- The visibility field is omitted from the request payload and must default to `private`.
- The visibility field is present but contains a value outside the allowed set.
- The requested repository already exists with a different visibility than the requested value.
- The tenant repository creation request is processed in a dry-run mode and must not create or change repository visibility.
- Repository creation succeeds but audit artifacts fail to persist the requested visibility field.
- The visibility dropdown options are updated in the issue form but the parser or workflow support modules are not updated in lockstep.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The issue form MUST include a `repository visibility` dropdown when requesting a tenant repository.
- **FR-002**: The visibility dropdown MUST include at least the options `private`, `internal`, and `public` when the target organization supports those visibilities. Support MUST be derived from configured tenant repository policy or the organization’s repository creation capability.
- **FR-003**: The visibility dropdown MUST default to `private` when the requester does not explicitly choose a different value.
- **FR-004**: The system MUST parse the repository visibility choice into a normalized request field such as `repository_visibility` or `requested_repository_visibility`.
- **FR-005**: The system MUST validate that the parsed visibility value is one of the allowed values and reject explicitly invalid values.
- **FR-006**: If the visibility field is absent from the request payload, the system MUST treat the requested visibility as `private`.
- **FR-007**: Execution MUST create a new repository with the requested visibility value when the repository does not already exist.
- **FR-008**: If the repository already exists and the existing visibility matches the requested visibility, execution MUST record a no-op outcome.
- **FR-009**: If the repository already exists and existing visibility differs from the requested visibility, execution MUST report a conflict or blocked outcome instead of silently changing the repository visibility.
- **FR-010**: The requested repository visibility MUST be stored in audit and summary outputs for review and traceability.
- **FR-011**: Visibility selection MUST not alter existing tenant boundary enforcement, approval binding, or governance-state validation requirements for tenant repository creation.
- **FR-012**: The workflow MUST preserve fail-closed behavior when visibility cannot be validated or when visibility selection creates an ambiguity that affects safe execution.
- **FR-013**: The request parser and workflow support modules MUST be updated to include visibility in schema validation, issue-form interpretation, and execution planning.
- **FR-014**: The feature MUST be backward compatible with existing repository creation request processing when visibility is omitted.
- **FR-015**: The feature MUST explicitly document allowed visibility values in issue-form guidance and validation output.

### Authorization Requirements *(mandatory)*

- **AR-001**: The existing authorization model for tenant repository creation MUST remain unchanged by this enhancement.
- **AR-002**: The requested visibility choice MUST not affect requester or approver authorization decisions.
- **AR-003**: The workflow MUST continue to require the same tenant-boundary approvals and governance checks before repository creation.
- **AR-004**: Visibility selection MUST not grant extra privileges automatically beyond the existing repository creation workflow.
- **AR-005**: The executing credential MUST still use least privilege while creating the repository with the requested visibility.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue form payload MUST be parsed into a normalized `repository_visibility` field prior to all validation and approval decisions.
- **VS-002**: Validation MUST treat absent visibility as `private` and explicitly reject unsupported visibility values.
- **VS-003**: Validation MUST verify that the requested visibility value is permitted by the target organization's configured repository visibility policy or repository creation capability.
- **VS-004**: Validation MUST produce a clear finding when the requested visibility is invalid or unsupported.
- **VS-005**: Validation MUST include the requested visibility value in request artifacts and summaries for traceability.
- **VS-006**: Dry-run validation MUST include the requested visibility in the intended mutation plan without mutating repository state.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST include a repository with the requested visibility in the validated target organization.
- **RL-002**: If the repository does not exist, execution MUST create it with the requested visibility and tenant-approved governance settings.
- **RL-003**: If the repository exists and matches the requested visibility, execution MUST report a deterministic no-op.
- **RL-004**: If the repository exists and visibility differs from the requested value, the workflow MUST not silently override visibility; it MUST record a conflict or blocked outcome and provide reviewer guidance.
- **RL-005**: Re-runs MUST preserve the selected visibility as part of the desired state so repeated executions remain idempotent.
- **RL-006**: Audit records MUST capture both requested visibility and actual repository visibility upon execution.

### Rollback Handling *(mandatory)*

- **RH-001**: If repository creation fails before the repository exists, the workflow MUST report a failed execution with no partial repository mutation.
- **RH-002**: If visibility could not be validated prior to creation, the workflow MUST report a blocked result before any mutation.
- **RH-003**: If the repository is created but the visibility audit or summary fails to persist, the workflow MUST report a partial failure rather than a silent success.
- **RH-004**: The workflow MUST not attempt to change repository visibility automatically as rollback compensation for an unrelated failure.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit the requested repository visibility and actual repository visibility in audit artifacts and step summaries.
- **OR-002**: The issue form guidance and validation output MUST document the default visibility behavior of `private`.
- **OR-003**: Permission and tenant boundary findings MUST continue to be visible alongside the selected visibility in audit summaries.
- **OR-004**: Validation failures for visibility MUST include both the invalid value and the allowed values in the output.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The change MUST reuse the existing create-repository call budget and avoid extra visibility-specific reads where possible.
- **GH-002**: The workflow MUST not perform additional rate-limit-sensitive operations solely for visibility unless required to verify support for the requested visibility.
- **GH-003**: If API limits prevent visibility support verification, the workflow MUST fail closed with explicit retry guidance.

### Testing Expectations *(mandatory)*

- **TE-001**: Parser tests MUST cover explicit visibility values `private`, `internal`, and `public`.
- **TE-002**: Parser tests MUST cover the absence of a visibility field and confirm the default `private` behavior.
- **TE-003**: Validation tests MUST cover invalid visibility values being rejected before approval or execution.
- **TE-004**: Execution tests MUST verify repository creation uses the selected visibility when creating a new repository.
- **TE-005**: Execution tests MUST verify existing repositories with matching visibility are treated as no-op.
- **TE-006**: Execution tests MUST verify existing repositories with mismatched visibility are reported as a blocked or conflict outcome.
- **TE-007**: Dry-run tests MUST verify the requested visibility is included in the planned outcome and no mutation occurs.
- **TE-008**: Contract tests MUST include updated issue-form payload fixtures and schema expectations for the new visibility dropdown.
- **TE-009**: Integration tests MUST include at least one end-to-end scenario that creates a repository with non-default visibility and confirms the created visibility.
- **TE-010**: Regression tests MUST ensure existing repository creation behavior continues to work when visibility is omitted.

### Key Entities *(include if feature involves data)*

- **Tenant Repository Creation Request**: The request record containing requester, target organization, repository name, designated approver, business justification, dry-run flag, and requested visibility.
- **Requested Repository Visibility**: The normalized visibility value selected from the dropdown and carried through validation, approval, audit, and execution.
- **Repository Visibility Validation Result**: The structured outcome of visibility value parsing and allowed-value validation, including defaulting behavior and rejection reasons.
- **Repository Creation Reconciliation Outcome**: The per-run result describing whether the repository was created, whether visibility matched, whether no-op occurred, and whether visibility conflict blocked execution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of repository creation requests without an explicit visibility choice default to `private` during parsing.
- **SC-002**: 100% of created repositories are created with the requested visibility value when the repo did not already exist.
- **SC-003**: 100% of invalid explicit visibility values are rejected before repository mutation.
- **SC-004**: 100% of executions that encounter an existing repository with differing visibility report a blocked or conflict outcome rather than silently changing visibility.
- **SC-005**: 100% of audit artifacts and summaries for this workflow include the requested repository visibility.

## Assumptions

- The tenant repository creation issue form can be updated to include a visibility dropdown field without changing the overall workflow authorization model.
- The allowed visibility values follow GitHub repository visibility semantics (`private`, `internal`, `public`) and the central organization can support them.
- `private` is the safe default for tenant repository creation and will not be silently changed by execution.
- Existing tenant repository creation workflow logic and authorization checks remain the primary gatekeepers for this enhancement.
- Existing issue payload parsing can be extended to support the new visibility field without requiring a new issue-form category.
- Repository creation execution is only responsible for applying visibility on create and reporting visibility mismatch for pre-existing repositories.
