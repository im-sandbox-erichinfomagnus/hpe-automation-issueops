# Quickstart: Add Team Repo Access CSV Attachment Intake

## Goal

Operate add-team-repo-access with `manual` and `csv_attachment` intake while preserving non-regression guarantees from specs 005 and 009 and enforcing terminal-state immutability for attachment reprocessing.

## Prerequisites

- IssueOps request access in repository.
- Target organization and team are visible to workflow identity.
- `ISSUEOPS_GITHUB_TOKEN` is configured with required read/write scope for repository access grants.
- Designated approver is valid under baseline add-team-repo-access approval model.
- Feature branch automation guardrails are enabled for this enhancement branch in CodeQL, Dependabot, and workflow lint automation.

## Phase 1 Setup Verification

1. Confirm fixture scaffolding files exist:
	- `tests/fixtures/add-team-repo-access-csv-attachment-issue.md`
	- `tests/fixtures/add-team-repo-access-csv-attachment-comments.json`
2. Confirm scaffold test files exist:
	- `tests/contract/add-team-repo-access-csv-attachment-parser-fixture.test.js`
	- `tests/contract/add-team-repo-access-csv-attachment-validation.test.js`
	- `tests/integration/add-team-repo-access-csv-attachment-request.test.js`
3. Confirm workflow trigger assumptions remain in place for add-team-repo-access issue and issue_comment events.
4. Confirm branch-level automation assumptions:
	- `.github/workflows/codeql.yml` includes `013-setup-feature-branch` under push branches.
	- `.github/workflows/lint-workflows.yml` includes `013-setup-feature-branch` under push branches.
	- `.github/dependabot.yml` targets `013-setup-feature-branch` for update PRs.

## Workflow Path

1. Submit request using intake_mode `manual` or `csv_attachment`.
2. For `manual`, preserve baseline behavior from feature 005.
3. For `csv_attachment`, initial valid metadata enters `waiting_for_attachment`.
4. Requester posts one same-issue CSV attachment comment.
5. Workflow resolves newest eligible requester attachment candidate after latest failed attempt.
6. Attachment is downloaded with bounded size checks, UTF-8 decode, and content hash capture.
7. CSV rows are validated with preserved feature-009 semantics and row findings.
8. Request advances to `awaiting_approval` only after accepted attachment and valid CSV rows.
9. Approval is evaluated with unchanged designated-approver model; central assignment remains routing-only.
10. Reconciliation computes drift and grants only missing eligible repository access.
11. Exact/stronger existing access remains no-op; weaker/conflicting existing states are rejected.
12. Terminal outcomes (`executed`, `partially_executed`, `failed_after_approved_execution`) are immutable for later attachment comments.

## Manual Runtime Verification (Operator Runbook)

Use this runbook after each workflow change to confirm the system is running and progressing in the expected direction.

1. Open a new add-team-repo-access issue with `intake_mode: csv_attachment`.
2. Confirm the first validation run reports:
	- `Request status: waiting_for_attachment`
	- `Validation: failed` with waiting guidance only
	- No approval-ready or mutation execution signal
3. Post one requester-authored CSV attachment comment containing two valid repositories.
4. Confirm the next run reports:
	- `Request status: awaiting_approval`
	- `Validation: passed`
	- Attachment provenance fields populated (`Attachment URL`, `Attachment comment ID`, `Attachment uploader`, `Attachment filename`, `Attachment content hash`)
5. Have the designated approver comment exactly `approved`.
6. Confirm approved execution run reports:
	- `Approval: approved (authorized)`
	- `Request status: executed`
	- `Granted repositories` and `No-op repositories` values match live target state
	- `Assignment semantics: routing only (never grants approval)`
7. Post another requester attachment comment after execution.
8. Confirm a follow-up run does not reopen lifecycle state and remains terminal.

## Validation Scenarios

### Scenario 1: Manual non-regression

1. Submit manual request with valid metadata and repository list.
2. Confirm behavior is equivalent to feature 005.

### Scenario 2: Waiting lifecycle for csv_attachment

1. Submit `csv_attachment` request without posting attachment comment.
2. Confirm `waiting_for_attachment` status and approval blocking.

### Scenario 3: Valid requester attachment progression

1. Post requester comment with exactly one valid CSV attachment.
2. Confirm provenance capture and `awaiting_approval` progression.
3. Approve and execute; verify mixed apply/no-op outcomes when applicable.

### Scenario 4: Failed then corrected attachment

1. Post malformed or invalid CSV attachment.
2. Confirm validation block and row-level findings.
3. Post newer corrected requester attachment comment.
4. Confirm newest eligible post-failure candidate is selected.

### Scenario 5: Terminal-state immutability

1. Complete execution to terminal state.
2. Post another requester CSV attachment comment.
3. Confirm request does not reopen to `waiting_for_attachment`, `validation_failed`, or `awaiting_approval`.

## Exit Criteria

- Manual path remains non-regressive to 005.
- CSV semantics remain non-regressive to 009.
- Waiting lifecycle, requester-only acceptance, correction supersession, and terminal immutability are validated.
- Audit evidence contains attachment provenance, row findings, approval, reconciliation, and final outcomes.
- Manual runtime verification confirms waiting -> awaiting_approval -> executed progression and terminal-state immutability.
