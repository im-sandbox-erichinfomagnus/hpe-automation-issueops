# Feature Specification: Add Bulk CSV Mode for Create Organization Teams

**Feature Branch**: `007-create-org-teams-bulk-csv-mode`  
**Created**: 2026-05-19  
**Status**: Draft  
**Input**: User description: "Add an optional bulk CSV intake mode to the existing create-org-teams IssueOps workflow while preserving all behavior and guarantees from specs/003-create-org-teams/spec.md."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Existing Manual Requests (Priority: P1)

A requester continues to submit a standard create-org-teams request using the existing manual requested-team-names field and receives the same validation, approval, reconciliation, and audit behavior already defined for the create-org-teams workflow.

**Why this priority**: This enhancement is acceptable only if it remains additive. The current manual request path defined in `specs/003-create-org-teams/spec.md` must continue to work without behavioral regression.

**Independent Test**: Can be fully tested by submitting a manual create-org-teams request without using bulk CSV mode and verifying that intake, validation, approval gating, reconciliation, and reporting remain equivalent to the baseline feature behavior.

**Acceptance Scenarios**:

1. **Given** a requester fills only the existing requested-team-names field with valid team names, **When** the request is submitted, **Then** the workflow processes the request with behavior equivalent to `specs/003-create-org-teams/spec.md` and does not require bulk CSV input.
2. **Given** a requester submits a manual request containing duplicate, conflicting, or already-existing team definitions, **When** validation runs, **Then** the workflow produces the same rejection, no-op, or approval-ready outcomes already defined by the baseline feature.

---

### User Story 2 - Submit High-Volume Team Creation Requests with Bulk CSV (Priority: P2)

A requester pastes a CSV payload into an optional bulk CSV textarea so that many team names can be submitted in one request without manually entering one team name per line.

**Why this priority**: High-volume team-creation requests become easier to author and review, but this is secondary to preserving the current workflow behavior and approval guarantees.

**Independent Test**: Can be fully tested by submitting a request that uses the bulk CSV textarea with a valid header row and multiple team names, then verifying that the request becomes approval-ready with normalized team definitions equivalent to the manual path.

**Acceptance Scenarios**:

1. **Given** a requester provides a valid target organization, a single valid intended owner, and a bulk CSV payload with the required header row and valid team-name rows, **When** the request is submitted, **Then** the workflow parses the CSV, normalizes the rows into the standard requested-team model, and marks the request ready for approval review.
2. **Given** a requester provides both manual requested team names and a bulk CSV payload in the same request, **When** validation runs, **Then** the workflow rejects the request and instructs the requester to use exactly one intake mode.
3. **Given** a bulk CSV payload contains duplicate or slug-conflicting team names, **When** validation runs, **Then** the workflow deduplicates or rejects the definitions according to the same normalization and conflict rules used by the manual path and reports the relevant row findings.
4. **Given** a bulk CSV payload omits required headers, contains malformed rows, or includes unsupported columns, **When** validation runs, **Then** the workflow rejects the request and reports row-level findings that identify the failing rows and reasons.

---

### User Story 3 - Execute CSV-Driven Requests with Existing Approval and Reconciliation Rules (Priority: P3)

After approval, an intended owner and requester can rely on a CSV-driven request to execute with the same authorization, reconciliation-first mutation, idempotent rerun, and audit-reporting behavior as the existing manual create-org-teams flow.

**Why this priority**: Bulk CSV input changes only intake and parsing. Downstream privileged behavior must remain aligned with the existing feature so that approval and execution semantics do not diverge by input mode.

**Independent Test**: Can be fully tested by approving a valid CSV-driven request where some teams already exist and verifying that only missing teams are created while no-op and changed outcomes are reported consistently with the manual path.

**Acceptance Scenarios**:

1. **Given** an approved CSV-driven request where some requested teams already exist, **When** execution runs, **Then** the workflow creates only missing teams and reports already-existing teams as no-op outcomes just as it does for manual requests.
2. **Given** a previously approved CSV-driven request is re-run after all requested teams already exist, **When** reconciliation runs again, **Then** the workflow performs no duplicate team creation and reports an idempotent no-op result.

### Edge Cases

- A requester pastes a bulk CSV payload that omits the required `team_name` header.
- A bulk CSV payload includes blank lines, trailing whitespace, or fully empty rows between valid rows.
- A bulk CSV payload includes valid quoted `team_name` values that should normalize the same as unquoted values.
- A bulk CSV payload includes duplicate team names or different team names that normalize to the same slug.
- A bulk CSV payload contains unsupported columns such as `organization`, `intended_owner`, `parent_team`, `members`, or row-level approval data.
- A bulk CSV payload contains malformed quoting or inconsistent column counts across rows.
- A requester populates both the existing manual requested-team-names field and the bulk CSV textarea in the same request.
- A requester provides a valid CSV payload for a team set that changes between approval and execution because one or more teams are created by another actor before execution begins.
- A subset of CSV rows normalize successfully while another subset is rejected because of malformed or conflicting team definitions.
- A requester attempts to use CSV mode to introduce team membership, parent-team hierarchy, or multi-organization behavior that remains out of scope for the existing create-org-teams workflow.
- The workflow reaches a GitHub API throttling limit while validating or reconciling a high-volume CSV-driven request.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The enhancement MUST explicitly preserve the behavior defined in `specs/003-create-org-teams/spec.md` for requests that use the existing manual requested-team-names input mode.
- **FR-002**: The system MUST offer an optional bulk CSV textarea as a second intake mode for create-org-teams requests.
- **FR-003**: The system MUST continue to support the existing manual requested-team-names field without requiring bulk CSV input.
- **FR-004**: The system MUST require exactly one intake mode per request: manual requested-team-names input or bulk CSV input.
- **FR-005**: The system MUST treat a request that populates both intake modes as invalid and reject it before approval or mutation.
- **FR-006**: The bulk CSV intake mode MUST accept pasted UTF-8 text and require a header row.
- **FR-007**: The bulk CSV schema for this enhancement MUST require a `team_name` column and MUST reject requests that omit that column.
- **FR-008**: The bulk CSV intake mode MUST remain compatible with the existing single-organization request model and the single shared intended-owner approval model from `specs/003-create-org-teams/spec.md`.
- **FR-009**: The bulk CSV intake mode MUST reject unsupported columns that would imply row-level intended owners, team membership population, parent-team configuration, or multi-organization behavior.
- **FR-010**: The system MUST normalize valid CSV team names into the same requested-team semantic model used by the existing create-org-teams workflow, including slug derivation and conflict detection.
- **FR-011**: The system MUST ignore fully blank CSV rows without treating them as requested teams.
- **FR-012**: The system MUST reject malformed CSV payloads, invalid team definitions, missing required values, duplicate rows that cannot be normalized safely, and inconsistent row shapes before the request can proceed to approval.
- **FR-013**: The system MUST report CSV validation findings with row-level detail sufficient for the requester and approver to identify which rows failed and why.
- **FR-014**: After successful parsing, the system MUST pass CSV-derived requests through the same approval, reconciliation, mutation, no-op, and audit flow as manual requests.
- **FR-015**: The system MUST continue to create only empty teams and MUST NOT accept, model, or process team members as part of CSV intake.
- **FR-016**: The system MUST continue to treat parent-team configuration as out of scope for this enhancement and reject any such input with a clear message.
- **FR-017**: The system MUST preserve clear completion reporting that distinguishes created teams, already-existing teams, rejected rows, duplicate or conflicting rows, and failed rows regardless of intake mode.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST continue to be derived from the GitHub user who submitted the issue, independent of intake mode.
- **AR-002**: Approval MUST remain centrally gated in the central repository and MUST continue to require the single intended owner shared across the full request batch, exactly as defined in `specs/003-create-org-teams/spec.md`.
- **AR-003**: CSV intake MUST NOT introduce per-row intended owners or any alternate approval path that weakens the existing batch approval guarantee.
- **AR-004**: The executing workflow identity MUST continue to use `ISSUEOPS_GITHUB_TOKEN` as the privileged credential for target-state validation, approver verification, and team creation unless a later enhancement explicitly changes that model.
- **AR-005**: Authorization checks MUST continue to verify requester context and approver eligibility before mutation, and bulk CSV intake MUST NOT bypass or weaken those checks.

### Validation Strategy *(mandatory)*

- **VS-001**: The request payload MUST be parsed into structured fields for organization, intended owner, intake mode, and normalized requested teams before any mutation step is eligible to run.
- **VS-002**: Preflight validation for manual requests MUST remain behaviorally equivalent to `specs/003-create-org-teams/spec.md`.
- **VS-003**: Preflight validation for bulk CSV requests MUST verify that exactly one intake mode is populated.
- **VS-004**: Preflight validation for bulk CSV requests MUST verify the presence of the required header row and the required `team_name` column before evaluating row data.
- **VS-005**: Preflight validation for bulk CSV requests MUST evaluate each non-blank row and record a 1-based data-row number that excludes the header row, the parsed team name, the normalized slug if available, and the failure reason for every invalid or conflicting row.
- **VS-006**: Preflight validation MUST normalize team names consistently across manual and CSV intake modes, including slug derivation, duplicate detection, and conflicting-slug detection.
- **VS-007**: Preflight validation MUST confirm that the target organization exists and that the intended owner remains valid in the target organization context before approval can unlock execution.
- **VS-008**: Preflight validation MUST reject requests that contain malformed CSV syntax, missing required values, unsupported columns, parent-team or membership instructions, or no valid requested teams after normalization.
- **VS-009**: Validation results for bulk CSV requests MUST expose aggregate and row-level findings to reviewers before approval is used to authorize execution.

### Reconciliation Logic *(mandatory)*

- **RL-001**: The system MUST read the current team state from the target organization before applying any approved change, regardless of intake mode.
- **RL-002**: Desired state for bulk CSV requests MUST be derived from the normalized requested-team list produced by CSV parsing and MUST match the same desired-state semantics used by manual requests.
- **RL-003**: The system MUST create only the requested teams that do not already exist.
- **RL-004**: The system MUST leave already-existing teams unchanged and report them as no-op outcomes.
- **RL-005**: Re-running the same approved CSV request MUST converge without duplicate team creation or conflicting outcomes.
- **RL-006**: If current state changes between approval and execution, the system MUST recalculate drift from the latest available organization state before attempting team creation.

### Rollback Handling *(mandatory)*

- **RH-001**: If a CSV-driven request fails before any team creation occurs, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds for a CSV-derived request, the system MUST record which teams were created and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when approval, validation, authorization, or CSV parsing prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured execution evidence for the request, chosen intake mode, validation outcome, assignment outcome, approval decision, reconciliation decision, and final team-creation result.
- **OR-002**: Observability outputs MUST include the issue or request identifier, workflow run identifier, requester, approver, target organization, intended owner, intake mode, requested team count, duplicate or conflicting row count, invalid row count, created team count, and no-op team count.
- **OR-003**: The system MUST present a human-readable summary back to the requester and approvers that identifies whether the request used manual or bulk CSV intake and summarizes any row-level validation failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by normalizing and deduplicating CSV team names before organization and existing-team lookups are made.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered during validation or reconciliation.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify that manual intake remains behaviorally equivalent to the baseline `003-create-org-teams` feature.
- **TE-002**: Tests MUST verify valid and invalid CSV parsing, including header validation, malformed row handling, blank-row handling, duplicate-row handling, conflicting-slug handling, and unsupported-column handling.
- **TE-003**: Tests MUST verify that requests are rejected when both intake modes are populated or when neither intake mode yields at least one valid requested team.
- **TE-004**: Tests MUST verify that approval remains blocked unless the single shared intended owner approves the full request batch, regardless of intake mode.
- **TE-005**: Tests MUST verify reconciliation behavior for CSV-driven requests with all-new teams, mixed existing-and-new teams, and fully satisfied reruns.
- **TE-006**: Tests MUST verify row-level validation reporting, audit outputs, partial failure reporting, bounded retry behavior, and rate-limit handling outcomes for bulk CSV requests.
- **TE-007**: Tests MUST verify that CSV requests attempting to introduce parent-team settings, team members, or row-level intended owners are rejected as out of scope.

### Key Entities *(include if feature involves data)*

- **Team Creation Request**: The existing request record for create-org-teams, extended to capture the selected intake mode while preserving the baseline fields for requester, target organization, intended owner, requested teams, approval state, validation outcome, and execution outcome.
- **Bulk CSV Submission**: A pasted CSV payload associated with a single create-org-teams request, containing a required header row and zero or more team rows intended to normalize into requested teams for one target organization and one shared intended owner.
- **CSV Row Finding**: A validation record for an individual CSV data row that captures the 1-based row number excluding the header row, original row content, normalized team name, normalized slug if available, validation status, and failure reason.
- **Team Creation Reconciliation Result**: The existing summary of current-state findings, teams created, no-op teams, failed teams, and required follow-up action, reused unchanged after CSV parsing normalizes the request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid manual create-org-teams requests continue to reach the same validation and approval-gating behavior defined by `specs/003-create-org-teams/spec.md` without requiring changes in requester behavior.
- **SC-002**: 95% of syntactically valid bulk CSV requests with a visible target organization, a valid shared intended owner, and non-conflicting team names reach an approval-ready state without manual workflow intervention on first submission.
- **SC-003**: 100% of execution attempts without approval from the valid shared intended owner remain blocked from creating teams for both manual and bulk CSV intake modes.
- **SC-004**: 100% of repeated executions for already-satisfied CSV-driven requests complete without duplicate team creation.
- **SC-005**: For completed bulk CSV runs, requesters and approvers can determine from the recorded outcome which rows were accepted, rejected, skipped, conflicted, or failed without inspecting raw system internals.

## Assumptions

- `specs/003-create-org-teams/spec.md` remains the authoritative baseline for all unchanged create-org-teams behavior.
- Requests continue to be submitted by authenticated GitHub users through the repository's standard IssueOps intake flow.
- The target organization and shared intended owner remain request-scoped fields outside the CSV payload for this enhancement so the workflow continues to process one organization and one approval authority per request.
- Bulk CSV input is pasted as plain UTF-8 text into an issue-form textarea rather than uploaded as an attachment.
- This workflow continues to create empty teams only; adding members to those teams remains the responsibility of a separate IssueOps workflow.
- Parent-team configuration, multi-organization requests, row-level intended owners, and notification-model changes remain out of scope for this enhancement.
- The `ISSUEOPS_GITHUB_TOKEN` secret remains available with sufficient permission to validate organization state, verify the intended owner, and create missing teams.