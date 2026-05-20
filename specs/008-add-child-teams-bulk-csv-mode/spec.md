# Feature Specification: Add Bulk CSV Mode for Add Child Teams

**Feature Branch**: `008-add-child-teams-bulk-csv-mode`  
**Created**: 2026-05-20  
**Status**: Draft  
**Input**: User description: "Add an optional bulk CSV intake mode to the existing add-child-teams IssueOps workflow while preserving all behavior and guarantees from specs/004-add-child-teams/spec.md."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Existing Manual Requests (Priority: P1)

A requester continues to submit a standard add-child-teams request using the existing manual requested-child-teams field and receives the same validation, approval, reconciliation, and audit behavior already defined for the add-child-teams workflow.

**Why this priority**: This enhancement is acceptable only if it remains additive. The current manual request path defined in `specs/004-add-child-teams/spec.md` must continue to work without behavioral regression.

**Independent Test**: Can be fully tested by submitting a manual add-child-teams request without using bulk CSV mode and verifying that intake, validation, approval gating, reconciliation, and reporting remain equivalent to the baseline feature behavior.

**Acceptance Scenarios**:

1. **Given** a requester fills only the existing requested-child-teams field with valid child-team names, **When** the request is submitted, **Then** the workflow processes the request with behavior equivalent to `specs/004-add-child-teams/spec.md` and does not require bulk CSV input.
2. **Given** a requester submits a manual request containing duplicate, conflicting, already-linked, re-parenting, or cycle-creating child-team definitions, **When** validation runs, **Then** the workflow produces the same rejection, no-op, or approval-ready outcomes already defined by the baseline feature.

---

### User Story 2 - Submit High-Volume Hierarchy Requests with Bulk CSV (Priority: P2)

A requester pastes a CSV payload into an optional bulk CSV textarea so that many child teams can be submitted in one request without manually entering one child team per line.

**Why this priority**: High-volume hierarchy requests become easier to author and review, but this remains secondary to preserving the current workflow behavior and approval guarantees.

**Independent Test**: Can be fully tested by submitting a request that uses the bulk CSV textarea with a valid header row and multiple child-team rows, then verifying that the request becomes approval-ready with normalized child-team definitions equivalent to the manual path.

**Acceptance Scenarios**:

1. **Given** a requester provides a valid target organization, one valid parent team, one valid designated hierarchy approver, and a bulk CSV payload with the required header row and valid child-team rows, **When** the request is submitted, **Then** the workflow parses the CSV, normalizes the rows into the standard requested-child-link model, and marks the request ready for approval review.
2. **Given** a requester provides both manual requested child teams and a bulk CSV payload in the same request, **When** validation runs, **Then** the workflow rejects the request and instructs the requester to use exactly one intake mode.
3. **Given** a bulk CSV payload contains duplicate or slug-conflicting child-team rows, **When** validation runs, **Then** the workflow deduplicates or rejects the rows according to the same normalization and conflict rules used by the manual path and reports the relevant row findings.
4. **Given** a bulk CSV payload omits required headers, contains malformed rows, or includes unsupported columns, **When** validation runs, **Then** the workflow rejects the request and reports row-level findings that identify the failing rows and reasons.

---

### User Story 3 - Execute CSV-Driven Requests with Existing Approval and Reconciliation Rules (Priority: P3)

After approval, a designated hierarchy approver and requester can rely on a CSV-driven request to execute with the same authorization, reconciliation-first mutation, idempotent rerun, and audit-reporting behavior as the existing manual add-child-teams flow.

**Why this priority**: Bulk CSV input changes only intake and parsing. Downstream privileged behavior must remain aligned with the existing feature so that approval and execution semantics do not diverge by input mode.

**Independent Test**: Can be fully tested by approving a valid CSV-driven request where some child teams are already linked to the parent and verifying that only missing links are applied while no-op and changed outcomes are reported consistently with the manual path.

**Acceptance Scenarios**:

1. **Given** an approved CSV-driven request where some requested child teams are already attached to the requested parent, **When** execution runs, **Then** the workflow links only missing child teams and reports already-attached child teams as no-op outcomes just as it does for manual requests.
2. **Given** a previously approved CSV-driven request is re-run after all requested child-team links are already satisfied, **When** reconciliation runs again, **Then** the workflow performs no duplicate hierarchy mutations and reports an idempotent no-op result.

### Edge Cases

- A requester pastes a bulk CSV payload that omits the required `child_team` or equivalent required child-team header.
- A bulk CSV payload includes blank lines, trailing whitespace, or fully empty rows between valid rows.
- A bulk CSV payload includes duplicate child-team names or different child-team names that normalize to the same slug.
- A bulk CSV payload contains malformed quoting or inconsistent column counts across rows.
- A bulk CSV payload contains unsupported columns such as `organization`, `parent_team`, `designated_approver`, `members`, `repositories`, or other row-level override data.
- A requester populates both the existing manual requested-child-teams field and the bulk CSV textarea in the same request.
- A requester leaves both intake modes effectively empty because the manual field is blank and all CSV rows are blank or invalid.
- A requester provides a valid CSV payload for child teams whose current hierarchy state changes between approval and execution.
- A subset of CSV rows normalize successfully while another subset is rejected because of malformed or conflicting child-team definitions.
- A requested child team is already attached to the requested parent before approval or execution.
- A requested child team is attached to a different parent when the request is validated or executed.
- A requested hierarchy change would create a cycle in the team tree.
- A request attempts to mix teams from different organizations or introduce multiple parent teams within one batch.
- The workflow token is missing, lacks sufficient permission, or cannot see the target organization and team hierarchy state.
- Dry-run is requested and the workflow must stop before mutation while still emitting reviewable reconciliation output.
- GitHub API throttling interrupts validation or execution after some requested child-team links have already been processed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The enhancement MUST explicitly preserve the behavior defined in `specs/004-add-child-teams/spec.md` for requests that use the existing manual requested-child-teams input mode.
- **FR-002**: The system MUST offer an optional bulk CSV textarea as a second intake mode for add-child-teams requests.
- **FR-003**: The system MUST continue to support the existing manual requested-child-teams field without requiring bulk CSV input.
- **FR-004**: The system MUST require exactly one intake mode per request: manual requested-child-teams input or bulk CSV input.
- **FR-005**: The system MUST treat a request that populates both intake modes as invalid and reject it before approval or mutation.
- **FR-006**: The bulk CSV intake mode MUST accept pasted UTF-8 text and require a header row.
- **FR-007**: The bulk CSV schema for this enhancement MUST require one child-team column and MUST reject requests that omit that column.
- **FR-008**: The bulk CSV intake mode MUST remain compatible with the existing single-organization, single-parent-team, and single-designated-approver request model from `specs/004-add-child-teams/spec.md`.
- **FR-009**: The bulk CSV intake mode MUST reject unsupported columns that would imply row-level organization overrides, parent-team overrides, approver overrides, team creation, membership management, repository access changes, or multi-parent behavior.
- **FR-010**: The system MUST normalize valid CSV child-team names into the same requested-child-link semantic model used by the existing add-child-teams workflow, including whitespace normalization, slug derivation, duplicate detection, and conflicting-slug detection.
- **FR-011**: The system MUST ignore fully blank CSV rows without treating them as requested child teams.
- **FR-012**: The system MUST reject malformed CSV payloads, invalid child-team definitions, missing required values, duplicate rows that cannot be normalized safely, and inconsistent row shapes before the request can proceed to approval.
- **FR-013**: The system MUST report CSV validation findings with row-level detail sufficient for the requester and approver to identify which rows failed and why.
- **FR-014**: After successful parsing, the system MUST pass CSV-derived requests through the same approval, reconciliation, mutation, no-op, and audit flow as manual requests.
- **FR-015**: The system MUST continue to reject child teams that are currently attached to a different parent team for this feature version rather than silently re-parent them.
- **FR-016**: The system MUST continue to reject hierarchy mutations that would create a cycle in the target team tree.
- **FR-017**: The system MUST preserve clear completion reporting that distinguishes applied links, already-satisfied links, rejected rows, duplicate or conflicting rows, and failed rows regardless of intake mode.
- **FR-018**: The system MUST keep this enhancement scoped to team-hierarchy management only and MUST NOT create or delete teams, add or remove team members, grant repositories, or change team settings other than the requested parent-child relationship.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST continue to be derived from the GitHub user who submitted the issue, independent of intake mode.
- **AR-002**: Approval MUST remain centrally gated in the central repository and MUST continue to require the single designated hierarchy approver shared across the full request batch, exactly as defined in `specs/004-add-child-teams/spec.md`.
- **AR-003**: Central issue assignment MUST remain routing-only and MUST NOT count as approval for manual or CSV-driven requests.
- **AR-004**: CSV intake MUST NOT introduce per-row approvers or any alternate approval path that weakens the existing batch approval guarantee.
- **AR-005**: The designated hierarchy approver MUST continue to be verified against current GitHub organization and team-maintainer state for the requested parent team and every requested child team before approval can unlock execution.
- **AR-006**: The system MUST reject request batches that would require more than one valid hierarchy approver and direct the requester to split them into separately approvable requests.
- **AR-007**: The executing workflow identity MUST continue to use `ISSUEOPS_GITHUB_TOKEN` as the privileged credential for target-state validation, approver verification, and hierarchy mutation unless a later enhancement explicitly changes that model.
- **AR-008**: Authorization checks MUST continue to verify requester context and approver eligibility before mutation, and bulk CSV intake MUST NOT bypass or weaken those checks.

### Validation Strategy *(mandatory)*

- **VS-001**: The request payload MUST be parsed into structured fields for organization, parent team, designated hierarchy approver, intake mode, and normalized requested child teams before any mutation step is eligible to run.
- **VS-002**: Preflight validation for manual requests MUST remain behaviorally equivalent to `specs/004-add-child-teams/spec.md`.
- **VS-003**: Preflight validation for bulk CSV requests MUST verify that exactly one intake mode is populated.
- **VS-004**: Preflight validation for bulk CSV requests MUST verify the presence of the required header row and the required child-team column before evaluating row data.
- **VS-005**: Preflight validation for bulk CSV requests MUST evaluate each non-blank row and record a 1-based data-row number that excludes the header row, the parsed child-team value, the normalized slug if available, and the failure reason for every invalid or conflicting row.
- **VS-006**: Preflight validation MUST normalize child-team identifiers consistently across manual and CSV intake modes, including whitespace normalization, slug derivation, duplicate detection, and conflicting-slug detection.
- **VS-007**: Preflight validation MUST confirm that the target organization exists, that the requested parent team exists, and that each normalized child team exists in the same target organization as the parent team.
- **VS-008**: Preflight validation MUST confirm that the designated hierarchy approver remains valid in the target organization context for the requested parent-child links before approval can unlock execution.
- **VS-009**: Preflight validation MUST reject requests that contain malformed CSV syntax, missing required values, unsupported columns, mixed-organization or multi-parent instructions, or no valid requested child teams after normalization.
- **VS-010**: Preflight validation MUST determine which requested child teams are already attached to the requested parent, which are missing, which require re-parenting, and which would create cycles.
- **VS-011**: Validation results for bulk CSV requests MUST expose aggregate and row-level findings to reviewers before approval is used to authorize execution.

### Reconciliation Logic *(mandatory)*

- **RL-001**: The system MUST read the current parent-team and child-team hierarchy state from the target organization before applying any approved change, regardless of intake mode.
- **RL-002**: Desired state for bulk CSV requests MUST be derived from the normalized requested-child-team list produced by CSV parsing and MUST match the same desired-state semantics used by manual requests.
- **RL-003**: The system MUST add only the requested child-team links that are not already attached to the requested parent team.
- **RL-004**: The system MUST leave already-satisfied parent-child links unchanged and report them as no-op outcomes.
- **RL-005**: Re-running the same approved CSV request MUST converge without duplicate hierarchy mutations or conflicting outcomes.
- **RL-006**: If current hierarchy state changes between approval and execution, the system MUST recalculate drift from the latest available organization state before attempting mutation.
- **RL-007**: If only a subset of requested hierarchy links can be applied successfully, the system MUST preserve a per-link outcome record for applied, skipped, rejected, and failed items.

### Rollback Handling *(mandatory)*

- **RH-001**: If a CSV-driven request fails before any hierarchy mutation occurs, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds for a CSV-derived request, the system MUST record which hierarchy links were applied and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when approval, validation, authorization, or CSV parsing prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured execution evidence for the request, chosen intake mode, validation outcome, assignment outcome, approval decision, reconciliation decision, and final hierarchy result.
- **OR-002**: Observability outputs MUST include the issue or request identifier, workflow run identifier, requester, approver, target organization, parent team, intake mode, requested child-team count, duplicate or conflicting row count, invalid row count, applied-link count, no-op count, rejected count, failed count, and rollback status.
- **OR-003**: The system MUST present a human-readable summary back to the requester and approvers that identifies whether the request used manual or bulk CSV intake and summarizes any row-level validation failures.
- **OR-004**: Audit outputs MUST continue to distinguish central operational routing from target-side approval authorization for both intake modes.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by normalizing and deduplicating CSV child-team rows before organization, team, and hierarchy lookups are made.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered during validation or reconciliation.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify that manual intake remains behaviorally equivalent to the baseline `004-add-child-teams` feature.
- **TE-002**: Tests MUST verify valid and invalid CSV parsing, including header validation, malformed row handling, blank-row handling, duplicate-row handling, conflicting-slug handling, and unsupported-column handling.
- **TE-003**: Tests MUST verify that requests are rejected when both intake modes are populated or when neither intake mode yields at least one valid requested child team.
- **TE-004**: Tests MUST verify that approval remains blocked unless the single designated hierarchy approver approves the full request batch, regardless of intake mode.
- **TE-005**: Tests MUST verify reconciliation behavior for CSV-driven requests with all-new hierarchy links, mixed already-linked and missing links, and fully satisfied reruns.
- **TE-006**: Tests MUST verify rejection of CSV requests that attempt re-parenting, cycle creation, multi-parent scope, mixed-organization scope, or other out-of-scope hierarchy changes.
- **TE-007**: Tests MUST verify row-level validation reporting, audit outputs, partial failure reporting, bounded retry behavior, and rate-limit handling outcomes for bulk CSV requests.
- **TE-008**: Tests MUST verify that downstream approval, reconciliation, mutation, and audit behavior continue to use the same request model and execution semantics after CSV parsing rather than a separate execution path.

### Key Entities *(include if feature involves data)*

- **Team Hierarchy Request**: The existing request record for add-child-teams, extended to capture the selected intake mode while preserving the baseline fields for requester, target organization, parent team, designated hierarchy approver, requested child teams, approval state, validation outcome, and execution outcome.
- **Bulk CSV Submission**: A pasted CSV payload associated with a single add-child-teams request, containing a required header row and zero or more child-team rows intended to normalize into requested child links for one target organization, one parent team, and one designated hierarchy approver.
- **CSV Row Finding**: A validation record for an individual CSV data row that captures the 1-based row number excluding the header row, original row content, normalized child-team name, normalized slug if available, validation status, and failure reason.
- **Hierarchy Reconciliation Result**: The existing summary of current-state findings, child links applied, no-op links, rejected links, failed links, and required follow-up action, reused unchanged after CSV parsing normalizes the request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid manual add-child-teams requests continue to reach the same validation and approval-gating behavior defined by `specs/004-add-child-teams/spec.md` without requiring changes in requester behavior.
- **SC-002**: 95% of syntactically valid bulk CSV requests with a visible target organization, a valid parent team, a valid designated hierarchy approver, and non-conflicting child-team rows reach an approval-ready state without manual workflow intervention on first submission.
- **SC-003**: 100% of execution attempts without approval from the valid designated hierarchy approver remain blocked from mutating team hierarchy for both manual and bulk CSV intake modes.
- **SC-004**: 100% of repeated executions for already-satisfied CSV-driven requests complete without duplicate parent-child links.
- **SC-005**: For completed bulk CSV runs, requesters and approvers can determine from the recorded outcome which rows were accepted, deduplicated, rejected, skipped, applied, or failed without inspecting raw system internals.

## Assumptions

- `specs/004-add-child-teams/spec.md` remains the authoritative baseline for all unchanged add-child-teams behavior.
- Requests continue to be submitted by authenticated GitHub users through the repository's standard IssueOps intake flow.
- The target organization, parent team, designated hierarchy approver, business justification, and dry-run preference remain request-scoped fields outside the CSV payload for this enhancement so the workflow continues to process one parent-team batch per request.
- Bulk CSV input is pasted as plain UTF-8 text into an issue-form textarea rather than uploaded as an attachment.
- Team creation, team deletion, member-management changes, repository-permission changes, mirrored approval surfaces, GitHub App migration, and multi-organization or multi-parent requests remain out of scope for this enhancement.
- The `ISSUEOPS_GITHUB_TOKEN` secret remains available with sufficient permission to validate organization state, verify the designated hierarchy approver, inspect current hierarchy state, and apply approved missing child-team links.