# Feature Specification: Manage Cost Centers IssueOps Workflow

**Feature Branch**: `cost-center-management`  
**Created**: 2026-06-11  
**Status**: Draft  
**Input**: User description: "cost center add/remove based on spreadsheet, for the cost centers themselves; full CRUD including rename"

**Repository Structure Note**: Follow the constitution section `Repository Structure Conventions` for repository layout and artifact placement assumptions that this specification should respect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate a Cost-Center Change Spreadsheet (Priority: P1)

An enterprise billing administrator submits a spreadsheet of cost-center changes (create, rename, delete) in one issue, and the workflow parses every row, resolves each target against the enterprise's live cost centers when access is available, and produces an approval-ready plan that classifies every row before any mutation can run.

**Why this priority**: Bulk cost-center edits are only safe when each row is classified correctly at intake. Validating the whole sheet and surfacing per-row outcomes before approval is the most important control for this workflow.

**Independent Test**: Can be fully tested by submitting spreadsheets with valid and invalid rows and verifying that the workflow produces a per-row plan, rejects the rows it cannot apply, and only marks the request approval-ready when at least the structural request is sound.

**Acceptance Scenarios**:

1. **Given** a spreadsheet with a valid header and rows that create, rename, and delete cost centers, **When** validation runs with live enterprise access, **Then** the workflow resolves each target, classifies each row as create_cost_center, rename_cost_center, delete_cost_center, noop, or rejected, and marks the request awaiting_approval without mutating any cost center.
2. **Given** a spreadsheet that is missing the enterprise slug, missing the designated approver, empty, has an invalid header, or has a header but no data rows, **When** validation runs, **Then** the workflow marks the whole request validation_failed and does not advance to approval.
3. **Given** a spreadsheet where individual rows are invalid (bad action, missing cost_center, ambiguous target, blocked delete) but the structural request is sound, **When** validation runs, **Then** the workflow rejects only those rows with row-cited reasons and still carries the valid subset forward to approval.

---

### User Story 2 - Approve Cost-Center Changes Through the Designated Approver (Priority: P2)

A designated enterprise owner or billing manager named in the request comments `approved` on the issue, and the workflow accepts that approval only from that exact login before any cost-center mutation is eligible to run.

**Why this priority**: Cost-center entities affect enterprise billing rollups. Mutation must be gated behind an explicit approval from the named approver, not any commenter.

**Independent Test**: Can be fully tested by posting `approved` from the designated approver and from other accounts against the same request and verifying that only the designated approver unlocks execution.

**Acceptance Scenarios**:

1. **Given** a validated request whose designated approver comments exactly `approved`, **When** the approval gate runs, **Then** the workflow records approver_role designated_approver, sets approval_status approved, and marks the request approved.
2. **Given** a validated request where a non-designated account comments `approved`, **When** the approval gate runs, **Then** the workflow records approver_role other, sets approval_status denied, and execution does not run.
3. **Given** a validated request with no approval comment yet, **When** the approval gate runs, **Then** approval_status stays pending and the workflow instructs the designated approver to comment `approved`.

---

### User Story 3 - Execute Cost-Center Changes Idempotently (Priority: P3)

After valid approval and with a PAT-backed enterprise billing token present, execution re-validates against live cost centers and then applies creates, renames, and deletes in deterministic order with bounded retry, recording a per-row outcome and a terminal request status.

**Why this priority**: The business value is delivered only when the spreadsheet is actually applied to the enterprise cost centers safely and converges on re-run.

**Independent Test**: Can be fully tested by running approved requests against missing, existing, and already satisfied cost centers and verifying deterministic created, renamed, deleted, noop, and failed outcomes plus idempotent re-runs.

**Acceptance Scenarios**:

1. **Given** an approved non-dry-run request with a PAT-backed token, **When** execution runs, **Then** the workflow re-validates with live access, applies creates then renames then deletes, records per-row outcomes, sets request_status executed when every actionable row succeeds, and applies the label issueops:manage-cost-centers:executed.
2. **Given** an approved request whose cost centers already match the desired state (create of an existing name, delete of a missing name, rename to the current name), **When** execution runs, **Then** the workflow records noop outcomes, makes no duplicate mutation, and converges to the same end state on re-run.
3. **Given** an approved request where some rows apply and others fail at the API, **When** execution finishes, **Then** the workflow records partially_executed (or failed when nothing applied), sets rollback_status manual_follow_up_required, and reports per-row failure reasons.

### Edge Cases

- The spreadsheet is wrapped in a ```csv code fence and must be unwrapped before parsing.
- A cost-center name contains a comma and is double-quoted in the CSV.
- The spreadsheet contains duplicate rows that must be deduped before evaluation.
- A row uses an action outside the create/rename/delete enum.
- A rename row omits new_name.
- A rename or delete name matches more than one active cost center and no cost_center_id is supplied, so the row is rejected with the candidate ids listed.
- A rename targets a name already used by a different cost center (name_taken).
- A rename targets the cost center's current name (noop).
- A delete targets a cost center that still has attached resources and force is not set (delete_blocked), listing the attached resources.
- A delete with force=true removes a non-empty cost center deliberately.
- A create names a cost center that already exists (noop).
- A delete names a cost center that does not exist (noop).
- Two rows target the same cost center with different actions (conflicting_rows, both rejected).
- No enterprise billing token or slug is available, so live cost centers cannot be listed and the plan is produced unverified from the spreadsheet, approval-ready, dry-run only.
- A name exceeds the 255-character maximum.
- Dry-run is requested and execution must emit the plan without creating, renaming, or deleting anything.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow one requester to submit one spreadsheet of cost-center changes per issue, covering create, rename, and delete actions for one enterprise.
- **FR-002**: The request MUST capture the enterprise slug, designated approver login, the cost-center spreadsheet (CSV), an explicit dry-run intent that defaults to true, and a business justification.
- **FR-003**: The system MUST parse the spreadsheet into one row per change, supporting double-quoted fields with embedded commas and an optional ```csv code fence.
- **FR-004**: The system MUST recognize the columns cost_center, action, new_name, cost_center_id, and force, treat unknown columns as ignored, and warn when ignored columns are present.
- **FR-005**: The system MUST require cost_center and action on every row and MUST accept only the actions create, rename, and delete.
- **FR-006**: The system MUST dedupe identical rows and report the number of duplicate rows removed.
- **FR-007**: The system MUST number data rows 1-based excluding the header and cite that row number in every per-row finding.
- **FR-008**: For a create row, the system MUST plan create_cost_center when no active cost center already uses the name and MUST record a noop when the name already exists.
- **FR-009**: For a rename row, the system MUST require new_name, resolve the target by cost_center_id when supplied otherwise by name, reject an ambiguous name with no id while listing candidate ids, reject a not-found target, record a noop when the target already has the requested name, and reject a rename to a name already used by another cost center as name_taken.
- **FR-010**: For a delete row, the system MUST resolve the target by cost_center_id when supplied otherwise by name, treat a missing target as a noop, reject an ambiguous name with no id while listing candidate ids, and reject a delete of a cost center that still has attached resources as delete_blocked unless force is true.
- **FR-011**: The system MUST reject all rows in a cross-row conflict where two or more actionable rows target the same cost center with different actions.
- **FR-012**: Per-row rejections MUST NOT fail the whole spreadsheet; the valid and unverified subset MUST still proceed to approval.
- **FR-013**: The system MUST mark the whole request validation_failed when the enterprise slug is missing, the designated approver is missing, the spreadsheet is empty, the header is invalid, or the header has no data rows.
- **FR-014**: When no live enterprise access is available, the system MUST warn, produce an unverified plan from the spreadsheet that is still approval-ready, and run dry-run only, deferring target resolution to execution.
- **FR-015**: Approval MUST be granted only when the login that comments exactly `approved` equals the designated approver named in the request.
- **FR-016**: Execution MUST be blocked unless the request is approved, the approver role is designated_approver, dry-run is off, and the workflow token is a PAT-backed enterprise billing credential.
- **FR-017**: Execution MUST re-validate the request against live cost centers before applying any change.
- **FR-018**: Execution MUST apply changes in the deterministic order creates, then renames, then deletes.
- **FR-019**: Execution MUST be idempotent so that an existing create resolves to a noop, a missing delete resolves to a noop, and re-runs converge to the same end state.
- **FR-020**: Each executed row MUST record one outcome from created, renamed, deleted, noop, or failed.
- **FR-021**: The request MUST end in request_status executed, partially_executed, or failed, and the workflow MUST apply a terminal label issueops:manage-cost-centers:<status>.
- **FR-022**: The system MUST persist durable audit evidence for the request, validation, approval, reconciliation, and execution as a retained machine-readable artifact plus a human-readable step summary for every run.
- **FR-023**: Dry-run requests MUST pass validation and emit the plan without creating, renaming, or deleting any cost center.
- **FR-024**: This workflow MUST own cost-center entities only and MUST NOT manage user or resource allocation, organization or repository attach and detach, or budgets.

### Authorization Requirements *(mandatory)*

- **AR-001**: Requester identity MUST be derived from the GitHub user who created the request issue.
- **AR-002**: Approver identity MUST be derived from the GitHub user who comments exactly `approved` on the request issue.
- **AR-003**: A valid approver MUST be the exact login named in the designated_approver field of the request.
- **AR-004**: Approval MUST be denied when the approval comment comes from any login other than the designated approver.
- **AR-005**: There is no cheap REST check for a user's enterprise billing role, so requester and approver enterprise authority cannot be verified by the workflow; the hard mutation gate MUST be the enterprise-billing-scoped classic PAT.
- **AR-006**: The executing credential MUST be ISSUEOPS_GITHUB_TOKEN, a classic PAT with manage_billing:enterprise held by an enterprise owner or billing manager; GitHub App and fine-grained tokens MUST NOT be accepted.
- **AR-007**: assertCostCenterMutationAllowed MUST block mutation unless approval is approved, approver role is designated_approver, dry-run is off, and the token is PAT-backed.
- **AR-008**: Issue assignment or routing metadata MUST NOT authorize execution by itself.

### Validation Strategy *(mandatory)*

- **VS-001**: The issue-form payload MUST be parsed into structured fields (enterprise, designated_approver, cost_centers, dry_run, justification) before approval or mutation eligibility is evaluated.
- **VS-002**: Validation MUST parse the CSV, unwrap any ```csv fence, honor double-quoted fields, dedupe rows, and flag unsupported columns.
- **VS-003**: Validation MUST classify each row by action, citing the 1-based data-row number on every finding.
- **VS-004**: Validation MUST resolve create, rename, and delete targets against live cost centers when access is available, using cost_center_id first and name second.
- **VS-005**: Validation MUST reject ambiguous targets with no id, not-found rename targets, name_taken renames, and blocked deletes, and MUST record noop for already-satisfied rows.
- **VS-006**: Validation MUST detect cross-row conflicts and reject all rows involved.
- **VS-007**: Validation MUST fail the whole request structurally on missing enterprise, missing approver, empty CSV, invalid header, or header with no data rows.
- **VS-008**: Validation MUST support a fail-soft mode that, without live access, marks actionable rows unverified, warns, and keeps the request approval-ready under dry-run.
- **VS-009**: Validation MUST enforce a 255-character maximum on cost-center names.
- **VS-010**: Validation MUST support dry-run output that shows the full plan and per-row outcomes without changing any cost center.
- **VS-011**: Validation outputs MUST include explicit failure reasons (invalid_action, missing_cost_center, missing_new_name, name_too_long, ambiguous_cost_center, not_found, name_taken, delete_blocked, conflicting_rows) and actionable detail per row.

### Reconciliation Logic *(mandatory)*

- **RL-001**: Desired state MUST be defined as the set of cost-center create, rename, and delete actions described by the actionable rows of the spreadsheet for the target enterprise.
- **RL-002**: Reconciliation MUST carry only rows the validator marked valid or unverified and MUST bucket them into creates, renames, and deletes.
- **RL-003**: The reconciliation plan MUST order changes deterministically as creates, then renames, then deletes.
- **RL-004**: Execution MUST re-read live cost centers and re-validate before applying changes so the executed plan reflects current state.
- **RL-005**: An existing create MUST resolve to a noop and a missing delete MUST resolve to a noop with no duplicate mutation.
- **RL-006**: Re-runs MUST remain idempotent and MUST converge to the same end state.
- **RL-007**: A plan with no rows MUST be reported as blocked with reason no_rows.
- **RL-008**: A dry-run plan MUST report state validated and MUST NOT apply any change.

### Rollback Handling *(mandatory)*

- **RH-001**: If validation or the policy guard blocks the request before mutation, the workflow MUST report a zero-change outcome with no cost-center mutation attempted.
- **RH-002**: Each cost-center mutation MUST be attempted independently so a failure on one row does not prevent other rows from applying.
- **RH-003**: If any row fails after others applied, the workflow MUST report partially_executed and set rollback_status manual_follow_up_required.
- **RH-004**: If no row applies and at least one fails, the workflow MUST report failed and set rollback_status manual_follow_up_required.
- **RH-005**: The workflow MUST NOT attempt automated compensating deletes or recreates; recovery is a re-run of the idempotent plan or manual follow-up.

### Observability Requirements *(mandatory)*

- **OR-001**: The workflow MUST emit structured audit evidence for the request envelope, validation result, approval decision, reconciliation plan, and execution outcome.
- **OR-002**: Required correlation fields MUST include request id, issue number, repository, requester, enterprise, designated approver, dry-run flag, request status, and per-row outcome.
- **OR-003**: Human-readable step summaries MUST report validation pass or fail, live-access mode, approval decision and note, planned change and no-op and rejected counts, executed counts, rollback status, and a per-row outcome table.
- **OR-004**: Machine-readable artifacts MUST be uploaded and retained for every validation, approval, and execution path, even when the request is blocked or dry-run, and MUST distinguish structural validation failures from per-row rejections and from post-approval execution failures.

### GitHub API Rate Limit Handling *(mandatory)*

- **GH-001**: Live cost-center reads and mutations MUST run through bounded retry so transient failures do not sink the whole run.
- **GH-002**: Retry behavior MUST be bounded with backoff and MUST surface retry-after guidance from the cost-center endpoints.
- **GH-003**: A failed API call after bounded retry MUST be classified (rate_limited for 429, http_<status> otherwise, unknown_error when no status) and recorded as the row failure reason.

### Testing Expectations *(mandatory)*

- **TE-001**: Tests MUST cover CSV parsing for double-quoted fields, code-fence unwrapping, header detection, row dedup, and dry-run defaulting.
- **TE-002**: Tests MUST cover create, rename, and delete classification against live state, including create-existing noop, delete-missing noop, and rename-to-current noop.
- **TE-003**: Tests MUST cover ambiguous name rejection with candidate ids, id disambiguation, name_taken rename rejection, and blocked delete with and without force.
- **TE-004**: Tests MUST cover invalid action, missing fields, and conflicting cross-row rejection.
- **TE-005**: Tests MUST cover structural validation failure for missing enterprise or approver.
- **TE-006**: Tests MUST cover the full validate, approve, execute flow applying create, rename, and delete while skipping blocked rows.
- **TE-007**: Tests MUST cover denial of a non-designated approver.
- **TE-008**: Tests MUST cover dry-run approved execution making no mutation.
- **TE-009**: Tests MUST cover the fail-soft path where no token yields an unverified, approval-ready plan.
- **TE-010**: Tests MUST cover the policy guard blocking execution without a PAT-backed token.

### Key Entities *(include if feature involves data)*

- **Cost-Center Change Request**: The parsed request envelope containing requester, enterprise, designated approver, dry-run intent, justification, the parsed CSV header and schema status, dedup count, and the list of requested change rows.
- **Cost-Center Change Row**: One parsed and evaluated spreadsheet row carrying the source row number, cost_center input, action, new_name, cost_center_id, force flag, resolved target, desired action, validation status, failure reason, and detail.
- **Cost-Center Reconciliation Plan**: The bucketed and ordered set of creates, renames, deletes, noops, and rejected rows with mutation, no-op, and rejected counts and a state of blocked, validated, or approved_for_execution.
- **Cost-Center Approval Decision**: The approval-gate record carrying approval status, approver login, approver role, approval timestamp, decision source, and decision note.
- **Cost-Center Execution Outcome**: The per-step execution record carrying created, renamed, deleted, noop, failure, and executed counts, rollback status, summary, and per-row results.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of structurally invalid requests (missing enterprise, missing approver, empty or invalid-header CSV, no data rows) are blocked before approval.
- **SC-002**: 100% of per-row rejections cite the 1-based data-row number and a specific failure reason without sinking the valid subset.
- **SC-003**: 100% of mutation attempts are blocked unless approval is approved by the designated approver, dry-run is off, and the token is PAT-backed.
- **SC-004**: 100% of re-runs for already satisfied requests complete without duplicate creates, renames, or deletes.
- **SC-005**: For blocked, executed, and partially_executed runs, reviewers can determine the per-row plan, approval decision, and final outcome from the summary and artifact without inspecting raw API payloads.

## Assumptions

- Requests are submitted by authenticated GitHub users through the central repository issue-form flow.
- This workflow owns cost-center entities only and is a sibling to the separate cost-center allocation operation that manages user and resource membership.
- The designated approver is an enterprise owner or billing manager whose login is named in the request and who comments `approved`.
- ISSUEOPS_GITHUB_TOKEN, when present, is a classic PAT with manage_billing:enterprise sufficient to list, create, rename, and delete enterprise cost centers.
- The current expected operating mode is fail-soft dry-run until an enterprise billing token and slug are provided, matching the posture of the prior cost-center allocation operation.
- Enterprise billing role for the requester and approver cannot be verified cheaply over REST, so the PAT is the hard control and the approver-authority check is honest about that limitation.
- Live cost centers are the source of truth for current cost-center existence, names, and attached resources.
