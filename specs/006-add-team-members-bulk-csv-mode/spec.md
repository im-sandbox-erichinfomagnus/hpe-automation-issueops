# Feature Specification: Add Bulk CSV Mode for Team Members

**Feature Folder**: `006-add-team-members-bulk-csv-mode`  
**Created**: 2026-05-19  
**Status**: Draft  
**Input**: User description: "Add an optional bulk CSV mode textarea for the existing add-team-members IssueOps workflow while preserving all behavior and guarantees from specs/001-add-team-members/spec.md."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Existing Manual Requests (Priority: P1)

A requester continues to submit a standard add-team-members request using the existing manual requested-people field and receives the same validation, approval, reconciliation, and audit behavior already defined for the add-team-members workflow.

**Why this priority**: This enhancement is only acceptable if it remains additive. The current manual request path defined in `specs/001-add-team-members/spec.md` must continue to work without behavioral regression.

**Independent Test**: Can be fully tested by submitting a manual add-team-members request without using bulk CSV mode and verifying that request intake, validation, approval gating, reconciliation, and reporting remain equivalent to the baseline feature behavior.

**Acceptance Scenarios**:

1. **Given** a requester fills only the existing manual requested-people field with valid usernames, **When** the request is submitted, **Then** the workflow processes the request with behavior equivalent to `specs/001-add-team-members/spec.md` and does not require bulk CSV input.
2. **Given** a requester submits a manual request for a non-existent team, **When** validation runs, **Then** the workflow rejects the request with the same team-existence requirement already defined for the baseline feature.

---

### User Story 2 - Submit High-Volume Membership Requests with Bulk CSV (Priority: P2)

A requester pastes a CSV payload into an optional bulk CSV textarea so that many requested usernames can be submitted in one request without manually entering one username per line.

**Why this priority**: High-volume membership requests become easier to author and review, but the enhancement remains secondary to preserving the current workflow behavior.

**Independent Test**: Can be fully tested by submitting a request that uses the bulk CSV textarea with a valid header row and multiple usernames, then verifying that the request becomes approval-ready with normalized people output equivalent to the manual path.

**Acceptance Scenarios**:

1. **Given** a requester provides a valid target organization, a valid target team, and a bulk CSV payload with the required header row and valid username rows, **When** the request is submitted, **Then** the workflow parses the CSV, normalizes the usernames into the standard request model, and marks the request ready for approval review.
2. **Given** a requester provides both manual requested people and a bulk CSV payload in the same request, **When** validation runs, **Then** the workflow rejects the request and instructs the requester to use exactly one intake mode.
3. **Given** a bulk CSV payload contains duplicate usernames, **When** validation runs, **Then** the workflow deduplicates the usernames for downstream reconciliation and reports the duplicate rows in validation findings.
4. **Given** a bulk CSV payload contains malformed rows, missing required headers, or invalid usernames, **When** validation runs, **Then** the workflow rejects the request and reports row-level findings that identify the failing rows and reasons.

---

### User Story 3 - Execute CSV-Driven Requests with Existing Approval and Reconciliation Rules (Priority: P3)

After approval, an organization owner and requester can rely on a CSV-driven request to execute with the same authorization, reconciliation-first mutation, idempotent rerun, and audit-reporting behavior as the existing manual add-team-members flow.

**Why this priority**: Bulk CSV input changes only intake and parsing. Downstream privileged behavior must remain aligned with the existing feature so that approval and execution semantics do not diverge by input mode.

**Independent Test**: Can be fully tested by approving a valid CSV-driven request where some usernames are already members and verifying that only missing users are added while no-op and changed outcomes are reported consistently with the manual path.

**Acceptance Scenarios**:

1. **Given** an approved CSV-driven request where some requested usernames are already team members, **When** execution runs, **Then** the workflow adds only missing users and reports already-satisfied memberships as no-op outcomes just as it does for manual requests.
2. **Given** a previously approved CSV-driven request is re-run after all requested memberships are already satisfied, **When** reconciliation runs again, **Then** the workflow performs no duplicate membership changes and reports an idempotent no-op result.

### Edge Cases

- A requester pastes a bulk CSV payload that omits the required `username` header.
- A bulk CSV payload includes blank lines, trailing whitespace, or fully empty rows between valid rows.
- A bulk CSV payload includes duplicate usernames that differ only by case or leading `@` characters.
- A bulk CSV payload contains additional unsupported columns that could imply multi-team or multi-organization behavior.
- A bulk CSV payload contains malformed quoting or inconsistent column counts across rows.
- A requester populates both the existing manual requested-people field and the bulk CSV textarea in the same request.
- A requester provides a valid CSV payload for a team that exists at intake time but is removed or renamed before execution.
- A subset of CSV rows resolve to valid organization accounts while another subset fails account resolution or policy checks.
- Approval is granted after the underlying team membership state changes relative to the validated intake payload.
- The workflow reaches a GitHub API throttling limit while validating or reconciling a high-volume CSV request.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The enhancement MUST explicitly preserve the behavior defined in `specs/001-add-team-members/spec.md` for requests that use the existing manual requested-people input mode.
- **FR-002**: The system MUST offer an optional bulk CSV textarea as a second intake mode for add-team-members requests.
- **FR-003**: The system MUST continue to support the existing manual requested-people field for add-team-members requests without requiring bulk CSV input.
- **FR-004**: The system MUST require exactly one intake mode per request: manual requested-people input or bulk CSV input.
- **FR-005**: The system MUST treat a request that populates both intake modes as invalid and reject it before approval or mutation.
- **FR-006**: The bulk CSV intake mode MUST accept pasted UTF-8 text and require a header row.
- **FR-007**: The bulk CSV intake mode MUST remain compatible with the existing single-team-per-request model and MUST NOT allow row-level organization or team overrides.
- **FR-008**: The bulk CSV schema for this enhancement MUST require a `username` column and MUST reject requests that omit that column.
- **FR-009**: The bulk CSV intake mode MUST reject unsupported columns that would imply behavior outside the current add-team-members scope.
- **FR-010**: The system MUST normalize valid CSV usernames into the same requested-people semantic model used by the existing add-team-members workflow.
- **FR-011**: The system MUST deduplicate repeated usernames across CSV rows before downstream reconciliation while preserving duplicate row findings for reviewer visibility.
- **FR-012**: The system MUST ignore fully blank CSV rows without treating them as requested users.
- **FR-013**: The system MUST reject malformed CSV payloads, invalid usernames, missing required row values, and inconsistent row shapes before the request can proceed to approval.
- **FR-014**: The system MUST report CSV validation findings with row-level detail sufficient for the requester and approver to identify which rows failed and why.
- **FR-015**: After successful parsing, the system MUST pass CSV-derived requests through the same approval, reconciliation, mutation, no-op, and audit flow as manual requests.
- **FR-016**: The system MUST preserve clear completion reporting that distinguishes successful additions, no-op memberships, rejected entries, duplicate rows, and failed entries regardless of intake mode.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST continue to be derived from the GitHub user who submitted the issue, independent of intake mode.
- **AR-002**: Only an organization owner may approve a request to add people to a team, and this approval requirement MUST remain identical for manual and bulk CSV requests.
- **AR-003**: The executing workflow identity MUST continue to use the minimum permissions needed to read team state, validate eligibility, and add members after approval.
- **AR-004**: Authorization checks MUST continue to verify requester context and approver role before mutation, and bulk CSV intake MUST NOT bypass or weaken those checks.

### Validation Strategy *(mandatory)*

- **VS-001**: The request payload MUST be parsed into structured fields for organization, team, intake mode, and normalized requested people before any mutation step is eligible to run.
- **VS-002**: Preflight validation for manual requests MUST remain behaviorally equivalent to `specs/001-add-team-members/spec.md`.
- **VS-003**: Preflight validation for bulk CSV requests MUST verify that exactly one intake mode is populated.
- **VS-004**: Preflight validation for bulk CSV requests MUST verify the presence of the required header row and the required `username` column before evaluating row data.
- **VS-005**: Preflight validation for bulk CSV requests MUST evaluate each non-blank row and record a 1-based data-row number that excludes the header row, the parsed username value, and the failure reason for every invalid row.
- **VS-006**: Preflight validation MUST normalize usernames consistently across manual and CSV intake modes, including case normalization and removal of leading `@` prefixes.
- **VS-007**: Preflight validation MUST confirm the target team exists and that each normalized requested person can be resolved to a valid GitHub account in the target organization context.
- **VS-008**: Preflight validation MUST reject requests that contain malformed CSV syntax, missing required values, invalid usernames, unsupported columns, or no valid requested people after normalization.
- **VS-009**: Validation results for bulk CSV requests MUST expose aggregate and row-level findings to reviewers before approval is used to authorize execution.

### Reconciliation Logic *(mandatory)*

- **RL-001**: The system MUST read the current membership of the target team before applying any approved change, regardless of intake mode.
- **RL-002**: Desired state for bulk CSV requests MUST be derived from the normalized requested-people list produced by CSV parsing and MUST match the same desired-state semantics used by manual requests.
- **RL-003**: The system MUST add only the requested people who are not already members of the target team.
- **RL-004**: The system MUST leave already-satisfied memberships unchanged and report them as no-op outcomes.
- **RL-005**: Re-running the same approved CSV request MUST converge without duplicating team memberships or generating conflicting outcomes.
- **RL-006**: If current state changes between approval and execution, the system MUST recalculate drift from the latest available team state before mutating membership.

### Rollback Handling *(mandatory)*

- **RH-001**: If a bulk CSV request fails before any membership change occurs, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds for a CSV-derived request, the system MUST record which memberships were added and which were not, and it MUST provide a compensating recovery path for the failed subset.
- **RH-003**: The system MUST fail closed when approval, validation, authorization, or CSV parsing prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured execution evidence for the request, chosen intake mode, validation outcome, approval decision, reconciliation decision, and final membership result.
- **OR-002**: Observability outputs MUST include the issue or request identifier, workflow run identifier, requester, approver, target organization, target team, intake mode, requested people count, duplicate row count, invalid row count, added people count, and no-op people count.
- **OR-003**: The system MUST present a human-readable summary back to the requester and approvers that identifies whether the request used manual or bulk CSV intake and summarizes any row-level validation failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by normalizing and deduplicating CSV usernames before any account-resolution or membership-read calls are made.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered during validation or reconciliation.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify that manual intake remains behaviorally equivalent to the baseline `001-add-team-members` feature.
- **TE-002**: Tests MUST verify valid and invalid CSV parsing, including header validation, malformed row handling, blank-row handling, duplicate-row handling, and invalid username handling.
- **TE-003**: Tests MUST verify that requests are rejected when both intake modes are populated or when neither intake mode yields at least one valid requested person.
- **TE-004**: Tests MUST verify that execution remains blocked until an organization owner approves the request, regardless of intake mode.
- **TE-005**: Tests MUST verify reconciliation behavior for CSV-driven requests with all-new memberships, partially satisfied memberships, and fully satisfied reruns.
- **TE-006**: Tests MUST verify row-level validation reporting, audit outputs, partial failure reporting, bounded retry behavior, and rate-limit handling outcomes for bulk CSV requests.

### Key Entities *(include if feature involves data)*

- **Team Membership Request**: The existing request record for add-team-members, extended to capture the selected intake mode while preserving the baseline fields for requester, target organization, target team, requested people, approval state, validation outcome, and execution outcome.
- **Bulk CSV Submission**: A pasted CSV payload associated with a single add-team-members request, containing a required header row and zero or more user rows intended to normalize into requested people for one target team.
- **CSV Row Finding**: A validation record for an individual CSV data row that captures the 1-based row number excluding the header row, original row content, normalized username if available, validation status, and failure reason.
- **Membership Reconciliation Result**: The existing summary of current-state findings, additions performed, no-op entries, failed entries, and required follow-up action, reused unchanged after CSV parsing normalizes the request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid manual requests continue to reach the same validation and approval-gating behavior defined by `specs/001-add-team-members/spec.md` without requiring changes in requester behavior.
- **SC-002**: 95% of syntactically valid bulk CSV requests with existing teams and resolvable usernames reach an approval-ready state without manual workflow intervention on first submission.
- **SC-003**: 100% of execution attempts without organization owner approval remain blocked from changing team membership for both manual and bulk CSV intake modes.
- **SC-004**: 100% of repeated executions for already-satisfied CSV-driven requests complete without duplicate team membership changes.
- **SC-005**: For completed bulk CSV runs, requesters and approvers can determine from the recorded outcome which rows were accepted, deduplicated, rejected, skipped, or failed without inspecting raw system internals.

## Assumptions

- `specs/001-add-team-members/spec.md` remains the authoritative baseline for all unchanged add-team-members behavior.
- Requests continue to be submitted by authenticated GitHub users through the repository's standard IssueOps intake flow.
- The target organization and target team remain request-scoped fields outside the CSV payload for this enhancement so the workflow continues to process one team per request.
- Bulk CSV input is pasted as plain UTF-8 text into an issue-form textarea rather than uploaded as an attachment.
- Removing people from teams, multi-team requests, and multi-organization requests remain out of scope for this enhancement.
