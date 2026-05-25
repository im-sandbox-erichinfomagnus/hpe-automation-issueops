# Quickstart: Add Child Teams CSV Attachment Intake

## Goal

Validate and operate the add-child-teams IssueOps workflow with `csv_attachment`
intake while preserving manual-path behavior, designated approver authorization,
reconciliation-first execution, and terminal-state immutability.

## Prerequisites

- Repository has issue forms enabled.
- You can create issues and post issue comments in the repository.
- Target organization has existing parent and child teams to validate.
- `ISSUEOPS_GITHUB_TOKEN` is configured with required visibility and mutation permissions.
- Designated hierarchy approver is valid for target parent and requested child-team scope.
- Requester account can post exactly one CSV attachment in a comment.

## Phase 1 Baseline

- Workflow entrypoint remains `.github/workflows/add-child-teams.yml`.
- Intake form remains `.github/ISSUE_TEMPLATE/add-child-teams.yml` with added intake-mode selection.
- Core execution scripts continue under `src/scripts/` for validation, approval gate, execution, and audit summary.
- Core policy and API modules continue under `src/workflow-support/` for parsing, validation, reconciliation, and GitHub hierarchy calls.
- Terminal-state evidence is read from restored per-issue audit artifacts and operation-aware issue labels.

## Proposed Workflow Path

1. Extend add-child-teams issue form with `intake_mode` values `manual` and `csv_attachment`.
2. Keep add-child-teams workflow shim thin and route issues and issue_comment events through existing validation and approval path.
3. Preserve manual-path parsing and normalization exactly as baseline behavior.
4. For `csv_attachment`, initialize lifecycle as `waiting_for_attachment` after metadata validation.
5. Discover candidate attachments from same-issue comments conservatively; require requester-authored comments and exactly one qualifying candidate per active attempt.
6. Download accepted attachment with bounded retries, enforce file-size and UTF-8 checks, then parse CSV using preserved 008 semantics.
7. Emit row-level findings with 1-based data-row numbering excluding header row.
8. Keep approval blocked until attachment CSV validation succeeds.
9. Reuse designated hierarchy approver verification and existing approval command path.
10. Reconcile against latest hierarchy state and apply only missing parent-child links, preserving no-op and dry-run behavior.
11. Persist audit outputs including attachment provenance and terminal-state evidence.
12. Ignore later requester attachment comments once request is terminal (`executed`, `partially_executed`, `failed_after_approved_execution`).
13. Confirm terminal labels match operation-aware outcomes: `issueops:add-child-teams:executed`, `issueops:add-child-teams:partially_executed`, and `issueops:add-child-teams:failed_after_approved_execution`.

## Validation Scenarios

### Scenario 1: Manual path non-regression

1. Submit request with intake mode `manual`.
2. Provide valid parent and child teams.
3. Confirm baseline validation, approval, and execution behavior remains unchanged.

### Scenario 2: Waiting lifecycle for csv_attachment

1. Submit request with intake mode `csv_attachment` and valid metadata.
2. Do not post attachment comment yet.
3. Confirm request state is `waiting_for_attachment` and approval is blocked.

### Scenario 3: Valid requester attachment

1. Post requester-authored comment with exactly one valid CSV attachment.
2. Confirm attachment provenance is captured and child rows normalize correctly.
3. Approve as designated hierarchy approver.
4. Confirm only missing links are created and already-linked relationships are reported as no-op.

### Scenario 4: Invalid attachment or CSV

1. Post ambiguous, oversized, non-CSV, or invalid-content attachment.
2. Confirm request remains blocked and reports reason.
3. Post corrected requester attachment in a later comment.
4. Confirm newest eligible requester comment after latest failed attempt is selected.

### Scenario 5: Terminal-state immutability

1. Execute an approved attachment-driven request to a terminal state.
2. Post a newer requester CSV attachment comment.
3. Confirm workflow ignores the comment and does not transition back to `waiting_for_attachment` or `awaiting_approval`.

## Exit Criteria

- Constitution checks in plan pass before and after design.
- Contract covers manual preservation, attachment lifecycle, authorization, reconciliation, observability, and terminal-state rule.
- Data model captures waiting lifecycle, attachment provenance, CSV row findings, and immutable terminal outcomes.
- Tests cover manual non-regression, waiting lifecycle, requester-only acceptance, correction supersession, dry-run, partial failures, bounded retries, and post-terminal ignore behavior.
