# Feature Specification: Add Bulk CSV Mode for Team Repository Access

**Feature Branch**: `009-add-team-repo-access-bulk-csv-mode`  
**Created**: 2026-05-20  
**Status**: Draft  
**Input**: User description: "Create a new feature specification for an enhancement that adds optional bulk CSV intake mode to the existing add-team-repo-access IssueOps workflow.

New spec folder name: `009-add-team-repo-access-bulk-csv-mode`

You MUST treat `specs/005-add-team-repo-access/spec.md` as the authoritative baseline for all unchanged behavior. The enhancement is additive only. The specification must explicitly preserve the existing manual request path, authorization model, validation semantics, reconciliation rules, approval requirements, audit behavior, dry-run behavior, rollback/compensating guidance, and rate-limit handling already defined in `specs/005-add-team-repo-access/spec.md`. The new spec must repeatedly and unambiguously reference that baseline so implementation cannot weaken or regress the existing manual workflow.

Also refer to the structure and tone used by these existing bulk-CSV enhancement specs, but do not copy behavior that would conflict with repo-access semantics:
- `specs/006-add-team-members-bulk-csv-mode/spec.md`
- `specs/007-create-org-teams-bulk-csv-mode/spec.md`

Feature intent:
Add an optional bulk CSV textarea to the existing add-team-repo-access workflow so a requester can submit many repository access grants for one existing team in one request, while preserving all current guarantees from `specs/005-add-team-repo-access/spec.md`."

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Existing Manual Requests (Priority: P1)

A requester continues to submit the existing add-team-repo-access request using the current manual repository list input and receives behavior equivalent to the baseline workflow defined in `specs/005-add-team-repo-access/spec.md`.

**Why this priority**: This enhancement is acceptable only if it remains additive. Non-regression for the existing manual request path is the highest-priority outcome.

**Independent Test**: Can be fully tested by submitting a manual add-team-repo-access request without using bulk CSV mode and verifying that intake, validation, approval gating, reconciliation, dry-run handling, and reporting remain equivalent to `specs/005-add-team-repo-access/spec.md`.

**Acceptance Scenarios**:

1. **Given** a requester fills only the existing manual repository input with valid repositories for one existing team, one target organization, and one supported permission level, **When** validation completes, **Then** the workflow behaves equivalently to `specs/005-add-team-repo-access/spec.md` and does not require bulk CSV input.
2. **Given** a requester submits a manual request containing duplicate repositories, missing repositories, archived repositories, or repositories that would require weaker-permission modification, **When** validation runs, **Then** the workflow produces the same rejection, no-op, or approval-ready outcomes already defined by `specs/005-add-team-repo-access/spec.md`.
3. **Given** a requester submits a valid manual request and a designated approver approves it in the central repository, **When** execution runs, **Then** the workflow grants only missing eligible repository access and preserves the same audit and rerun semantics already defined in `specs/005-add-team-repo-access/spec.md`.

---

### User Story 2 - Submit High-Volume Repository Access Requests with Bulk CSV (Priority: P2)

A requester pastes a CSV payload into an optional bulk CSV textarea so that many repository access grants for one existing team and one shared permission level can be submitted in one request without manually entering one repository per line.

**Why this priority**: High-volume repository access requests become easier to author and review, but this remains secondary to preserving the baseline workflow semantics.

**Independent Test**: Can be fully tested by submitting a request that uses the bulk CSV textarea with a valid header row and multiple repository rows, then verifying that the request becomes approval-ready with normalized requested repositories equivalent to the manual path.

**Acceptance Scenarios**:

1. **Given** a requester provides a valid target organization, an existing target team, one supported permission level, one designated approver, and a bulk CSV payload with the required header row and valid repository rows, **When** validation completes, **Then** the workflow parses the CSV, normalizes the repositories into the standard requested-repository model, and marks the request ready for approval review.
2. **Given** a requester provides both the manual repository input and a bulk CSV payload in the same request, **When** validation runs, **Then** the workflow rejects the request and instructs the requester to use exactly one intake mode.
3. **Given** a bulk CSV payload contains duplicate repository rows or different repository values that normalize to the same repository identifier, **When** validation runs, **Then** the workflow rejects the request according to the same repository-normalization safety rules used by `specs/005-add-team-repo-access/spec.md` and reports row-level findings for the duplicate or conflicting rows.
4. **Given** a bulk CSV payload omits the required header, contains malformed rows, includes unsupported columns, or contains invalid or ineligible repositories, **When** validation runs, **Then** the workflow rejects the request and reports row-level findings that identify the failing rows and reasons.

---

### User Story 3 - Execute CSV-Driven Requests with Existing Approval and Reconciliation Rules (Priority: P3)

After approval, a requester and designated approver can rely on a CSV-driven request to execute with the same authorization, reconciliation-first mutation, no-op handling, stale-state checks, idempotent rerun behavior, and audit reporting as the manual add-team-repo-access flow defined in `specs/005-add-team-repo-access/spec.md`.

**Why this priority**: Bulk CSV changes intake only. Approval, target-state validation, repository-permission mutation rules, and operational safety guarantees must remain aligned with the baseline workflow.

**Independent Test**: Can be fully tested by approving a valid CSV-driven request where some repositories need new grants, some already satisfy the request, some already have stronger permissions, and one repository fails, then verifying that only missing eligible grants are applied and the outcome preserves per-repository detail equivalent to the manual path.

**Acceptance Scenarios**:

1. **Given** an approved CSV-driven request where the team lacks access to some requested repositories and already satisfies others, **When** execution runs, **Then** the workflow grants only missing eligible access and records already-satisfied repositories as no-op outcomes just as it does for manual requests under `specs/005-add-team-repo-access/spec.md`.
2. **Given** an approved CSV-driven request where one repository access grant fails after others succeed, **When** execution finishes, **Then** the workflow records applied, skipped, rejected, and failed repository outcomes separately and provides operator-facing follow-up guidance for the failed subset.
3. **Given** a previously approved CSV-driven request is re-run after all requested repository access is already satisfied, **When** reconciliation runs again, **Then** the workflow performs no duplicate grants and reports an idempotent no-op result.

### Edge Cases

- A requester pastes a bulk CSV payload that omits the required `repository` header.
- A bulk CSV payload includes unsupported columns such as `organization`, `team`, `permission`, or `approver` that would imply row-level overrides or broader scope.
- A bulk CSV payload includes blank lines, trailing whitespace, or fully empty rows between valid rows.
- A bulk CSV payload includes quoted repository values that should normalize the same as unquoted values.
- A bulk CSV payload includes duplicate repository names or different repository strings that normalize to the same repository identifier.
- A bulk CSV payload contains malformed quoting or inconsistent column counts across rows.
- A requester populates both the existing manual repository field and the bulk CSV textarea in the same request.
- A requester populates neither intake mode or provides no valid repositories after normalization.
- The target organization does not exist or is not visible to the workflow identity.
- The requested team does not exist in the target organization.
- One or more requested repositories do not exist in the target organization.
- The request attempts to mix repositories from outside the target organization into the same batch.
- A requested repository is archived or otherwise not eligible for access mutation in this feature version.
- The team already has the exact requested permission on a repository before approval.
- The team already has a stronger permission than requested on a repository.
- The team already has a weaker or conflicting permission on a repository that would require modifying existing access rather than granting missing access.
- The designated approver is missing, unauthorized, or no longer an active owner in the target organization.
- The request would require more than one valid approver across the requested repository grants.
- The workflow token is missing, lacks sufficient permission, or cannot read required team, repository, or organization state.
- Dry-run is requested and the workflow must stop before mutation while still emitting reviewable reconciliation output.
- GitHub API throttling interrupts validation or execution after some repository grants have already been processed.
- Repository access state changes between approval and execution, including a repository being archived or access being granted by another actor.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The enhancement MUST explicitly preserve the behavior defined in `specs/005-add-team-repo-access/spec.md` for requests that use the existing manual repository input mode.
- **FR-002**: The system MUST offer an optional bulk CSV textarea as a second intake mode for add-team-repo-access requests.
- **FR-003**: The system MUST continue to support the existing manual repository input without requiring bulk CSV input.
- **FR-004**: The system MUST require exactly one intake mode per request: manual repository input or bulk CSV input.
- **FR-005**: The system MUST reject a request that populates both intake modes before approval or mutation can continue.
- **FR-006**: The system MUST reject a request when neither intake mode yields at least one valid requested repository.
- **FR-007**: The bulk CSV intake mode MUST accept pasted UTF-8 text and require a header row.
- **FR-008**: The bulk CSV schema for this enhancement MUST require a `repository` column and MUST reject requests that omit that column.
- **FR-009**: The bulk CSV intake mode MUST remain compatible with the existing single-organization, single-team, single-permission, and single-designated-approver request model from `specs/005-add-team-repo-access/spec.md`.
- **FR-010**: The bulk CSV intake mode MUST reject unsupported columns that imply row-level organization, team, permission, or approver overrides, or any broader repository-administration behavior outside the baseline scope.
- **FR-011**: The system MUST normalize valid CSV repository values into the same requested-repository semantic model used by the manual add-team-repo-access workflow.
- **FR-012**: The system MUST reject duplicate repository rows and conflicting normalized repository identifiers for CSV requests rather than silently deduplicating them, preserving the same normalization-safety rules used by `specs/005-add-team-repo-access/spec.md`.
- **FR-013**: The system MUST ignore fully blank CSV rows without treating them as requested repositories.
- **FR-014**: The system MUST reject malformed CSV payloads, missing required row values, invalid repository identifiers, unsupported columns, and inconsistent row shapes before the request can proceed to approval.
- **FR-015**: The system MUST report CSV validation findings with row-level detail sufficient for the requester and approver to identify which rows failed and why.
- **FR-016**: After successful parsing, the system MUST pass CSV-derived requests through the same approval, reconciliation, mutation, no-op, dry-run, rollback-guidance, and audit flow as manual requests.
- **FR-017**: The system MUST continue to grant only missing eligible repository access for the target team and MUST NOT create or delete repositories, create or delete teams, add or remove team members, remove team access, downgrade permissions, change repository settings, manage branch protections, or otherwise expand the scope already defined in `specs/005-add-team-repo-access/spec.md`.
- **FR-018**: The system MUST preserve clear completion reporting that distinguishes applied repository grants, already-satisfied repositories, rejected repositories, duplicate or conflicting CSV rows, invalid CSV rows, and failed repositories regardless of intake mode.

### Authorization Requirements *(mandatory)*

- **AR-001**: The requester identity MUST continue to be derived from the GitHub user who submitted the central repository request, independent of intake mode.
- **AR-002**: Approval MUST remain centrally gated in the central repository and MUST continue to require the designated active owner of the target organization for the full request batch exactly as defined in `specs/005-add-team-repo-access/spec.md`.
- **AR-003**: CSV intake MUST NOT introduce per-row approvers, alternate approval paths, or any weakening of the existing batch approval guarantee.
- **AR-004**: The workflow MUST automatically verify that the designated access approver is currently an active owner in the target organization before accepting approval for both manual and CSV requests.
- **AR-005**: The executing workflow identity MUST continue to use the `ISSUEOPS_GITHUB_TOKEN` secret as the privileged credential for target-state validation, approver verification, and repository team-permission mutation unless a later enhancement explicitly changes that model.
- **AR-006**: Authorization checks MUST continue to verify requester context, approver eligibility, and least-privilege PAT usage before mutation, and bulk CSV intake MUST NOT bypass or weaken those checks.
- **AR-007**: The workflow MUST fail closed when the PAT is missing, insufficient, revoked, or otherwise unauthorized for required validation or mutation steps.

### Validation Strategy *(mandatory)*

- **VS-001**: The request payload MUST be parsed into structured fields for target organization, requested team, requested permission level, designated approver, intake mode, and normalized requested repositories before any mutation step is eligible to run.
- **VS-002**: Preflight validation for manual requests MUST remain behaviorally equivalent to `specs/005-add-team-repo-access/spec.md`.
- **VS-003**: Preflight validation for bulk CSV requests MUST verify that exactly one intake mode is populated.
- **VS-004**: Preflight validation for bulk CSV requests MUST verify the presence of the required header row and the required `repository` column before evaluating row data.
- **VS-005**: Preflight validation for bulk CSV requests MUST evaluate each non-blank row and record a 1-based data-row number that excludes the header row, the parsed repository value, the normalized repository identifier if available, and the failure reason for every invalid, duplicate, conflicting, or unsupported row.
- **VS-006**: Preflight validation MUST normalize repository identifiers consistently across manual and CSV intake modes and reject duplicate or conflicting repository definitions that cannot be normalized safely.
- **VS-007**: Preflight validation MUST confirm that the requested permission level remains one of the supported built-in repository roles already defined in `specs/005-add-team-repo-access/spec.md`.
- **VS-008**: Preflight validation MUST confirm that the target organization exists and is visible to the workflow identity, that the requested team exists in that organization, and that each normalized requested repository exists in the same target organization and is eligible for access mutation.
- **VS-009**: Preflight validation MUST determine whether each requested repository currently has no team access, the exact requested permission, a stronger permission, or a conflicting weaker permission using the same repo-access semantics already defined in `specs/005-add-team-repo-access/spec.md`.
- **VS-010**: Preflight validation MUST reject requests that contain malformed CSV syntax, missing required values, unsupported columns, archived or ineligible repositories, weaker-permission conflicts, or no valid requested repositories after normalization.
- **VS-011**: Preflight validation MUST confirm that the designated access approver is currently an active owner in the target organization and that the full request batch remains approvable by one valid approver.
- **VS-012**: Validation results for bulk CSV requests MUST expose aggregate and row-level findings to reviewers before approval is used to authorize execution.
- **VS-013**: Validation MUST support dry-run evaluation that shows the reconciliation plan without mutating repository access for either intake mode.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state for both manual and bulk CSV requests MUST remain the target team having at least the requested permission level on every valid requested repository in the target organization.
- **RL-002**: The system MUST read current repository-team permission state from the target organization before applying any approved change, regardless of intake mode.
- **RL-003**: Desired state for bulk CSV requests MUST be derived from the normalized requested-repository list produced by CSV parsing and MUST match the same desired-state semantics used by manual requests.
- **RL-004**: The system MUST grant only missing eligible repository access for the target team.
- **RL-005**: Repositories where the team already has the exact requested permission or a stronger permission MUST be treated as no-op results and MUST NOT be rewritten.
- **RL-006**: Re-running the same approved CSV request MUST converge safely without duplicate grants or conflicting outcomes.
- **RL-007**: If current state changes between approval and execution, the system MUST recompute current state from the latest available data before attempting mutation.
- **RL-008**: If only a subset of requested repository grants can be applied successfully, the system MUST preserve a per-repository outcome record for applied, skipped, rejected, and failed items.

### Rollback Handling *(mandatory)*

- **RH-001**: If a CSV-driven request fails before any repository access mutation is applied, the system MUST report a zero-change failure result.
- **RH-002**: If execution partially succeeds for a CSV-derived request, the system MUST record which repository grants were applied and which were not, and it MUST provide operator-facing follow-up guidance for the failed subset.
- **RH-003**: The system MUST fail closed when authorization, validation, approval, CSV parsing, or repository-state prerequisites are not satisfied.

### Observability Requirements *(mandatory)*

- **OR-001**: The system MUST emit structured evidence for request intake, chosen intake mode, validation outcome, central issue assignment outcome, approval decision, reconciliation decision, and final execution result.
- **OR-002**: Observability outputs MUST include the central issue identifier, workflow run identifier, requester, approver, target organization, target team, requested permission level, intake mode, requested repository count, duplicate or conflicting CSV row count, invalid CSV row count, applied grant count, no-op count, rejected count, failed count, and rollback status.
- **OR-003**: The system MUST present a human-readable summary in the central repository context that identifies whether the request used manual or bulk CSV intake and summarizes any row-level validation failures.
- **OR-004**: Audit outputs MUST continue to clearly distinguish central operational routing from target-side approval authorization.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: The system MUST minimize unnecessary API calls by normalizing and rejecting duplicate or conflicting CSV repository entries before performing repository, team, permission-state, or approver lookups.
- **GH-002**: The system MUST back off and retry only within safe bounded limits when GitHub API throttling is encountered during validation, reconciliation, or execution.
- **GH-003**: If rate limiting prevents safe completion, the system MUST stop further mutation, preserve partial results, and report that the request requires a later retry or operator action.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST verify that manual intake remains behaviorally equivalent to the baseline `005-add-team-repo-access` feature.
- **TE-002**: Tests MUST verify valid and invalid CSV parsing, including header validation, malformed-row handling, blank-row handling, quoted repository values, duplicate-row handling, conflicting normalized repository handling, and unsupported-column handling.
- **TE-003**: Tests MUST verify that requests are rejected when both intake modes are populated or when neither intake mode yields at least one valid requested repository.
- **TE-004**: Tests MUST verify that supported built-in repository roles remain accepted and that unsupported custom roles remain rejected for both manual and CSV requests.
- **TE-005**: Tests MUST verify that approval remains blocked unless the designated active owner approves the full request batch in the central repository, regardless of intake mode.
- **TE-006**: Tests MUST verify reconciliation behavior for CSV-driven requests with all-new grants, mixed already-satisfied and missing grants, stronger-permission no-op results, weaker-permission conflict rejection, and fully satisfied reruns.
- **TE-007**: Tests MUST verify row-level validation reporting, dry-run output, audit artifacts, partial failure reporting, stale-state recomputation, and bounded retry behavior for bulk CSV requests.
- **TE-008**: Tests MUST verify that CSV requests attempting to introduce row-level organization, team, permission, or approver overrides are rejected as out of scope.

### Key Entities *(include if feature involves data)*

- **Repository Access Request**: The existing request record for add-team-repo-access, extended to capture the selected intake mode while preserving the baseline fields for requester, target organization, target team, requested permission level, designated approver, requested repositories, approval state, validation outcome, and execution outcome.
- **Bulk CSV Submission**: A pasted CSV payload associated with a single add-team-repo-access request, containing a required header row and zero or more repository rows intended to normalize into requested repository grants for one target organization, one target team, one requested permission level, and one designated approver.
- **CSV Row Finding**: A validation record for an individual CSV data row that captures the 1-based row number excluding the header row, original row content, normalized repository identifier if available, validation status, and failure reason.
- **Requested Repository Grant**: The baseline repository-grant entity from `specs/005-add-team-repo-access/spec.md`, reused after CSV parsing normalizes the request into the existing requested-repository model.
- **Repository Access Mutation Result**: The existing per-repository outcome record reused for CSV-derived requests to indicate whether access was granted, already satisfied, rejected before execution, or failed during execution.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid manual add-team-repo-access requests continue to reach the same validation and approval-gating behavior defined by `specs/005-add-team-repo-access/spec.md` without requiring changes in requester behavior.
- **SC-002**: 95% of syntactically valid bulk CSV requests with an existing visible target team, visible repositories, one supported permission level, and one valid designated approver reach an approval-ready state without manual workflow intervention on first submission.
- **SC-003**: 100% of execution attempts without valid designated target-side approval remain blocked from mutating repository access for both manual and bulk CSV intake modes.
- **SC-004**: 100% of repeated executions for already-satisfied CSV-driven requests complete without duplicate repository grants or permission downgrades.
- **SC-005**: For completed bulk CSV runs, requesters and approvers can determine from the recorded outcome which repositories were accepted, rejected, skipped as already satisfied, or failed without inspecting raw system internals.

## Assumptions

- `specs/005-add-team-repo-access/spec.md` remains the authoritative baseline for all unchanged add-team-repo-access behavior.
- Requests continue to be submitted by authenticated GitHub users through the repository's standard central IssueOps intake flow.
- The target organization, target team, requested permission level, and designated approver remain request-scoped fields outside the CSV payload so the workflow continues to process one team and one permission level per request.
- Bulk CSV input is pasted as plain UTF-8 text into an issue-form textarea rather than uploaded as an attachment.
- The `repository` column contains repository identifiers that can be normalized into the same comparison-safe model used by the existing manual add-team-repo-access workflow.
- Permission removal, permission downgrades, repository creation, repository deletion, team lifecycle changes, team membership changes, branch-protection changes, and GitHub App migration remain out of scope unless a later enhancement explicitly changes the baseline workflow.
- The `ISSUEOPS_GITHUB_TOKEN` secret remains available with sufficient permission to validate organization state, verify approver eligibility, inspect current team repository permissions, and apply approved missing repository access grants.
- Bulk CSV intake does not change the baseline rule that satisfying the request means granting only missing eligible repository access while treating stronger existing permissions as already satisfied and weaker conflicting permissions as rejected.
