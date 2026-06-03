# Quickstart: Create Organization Teams CSV Attachment Intake

## Goal

Validate and operate the create-org-teams IssueOps workflow after it is
enhanced with a requester-comment CSV attachment intake path while preserving
the existing manual request path, intended-owner approval gate,
reconciliation semantics, and audit outputs.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the repository.
- A target GitHub organization available for validation scenarios.
- A PAT with sufficient organization permissions, stored as a repository or organization secret for workflow use.
- A target organization member designated as the intended owner for the teams in a request batch.
- Ability to post issue comments with a single CSV attachment from the requester account.

## Phase 1 Baseline

- The workflow entrypoint remains `.github/workflows/create-org-teams.yml` and continues to run on `ubuntu-latest` with Node.js 24 setup through `actions/setup-node@v6`.
- Workflow linting is enforced by `.github/workflows/lint-workflows.yml` using `rhysd/actionlint@v1.7.12`.
- The enhancement extends `.github/ISSUE_TEMPLATE/create-org-teams.yml` rather than creating a parallel issue form or workflow.
- Existing approval-gate, execution, audit-artifact, and summary scripts remain in place under `src/scripts/` and `src/workflow-support/`.
- Phase 1 scaffold coverage is anchored by `tests/fixtures/create-org-teams-csv-attachment-issue.md`, `tests/fixtures/create-org-teams-csv-attachment-comments.json`, `tests/contract/create-org-teams-csv-attachment-parser-fixture.test.js`, `tests/contract/create-org-teams-csv-attachment-validation.test.js`, and `tests/integration/create-org-teams-csv-attachment-request.test.js`.

## Proposed Workflow Path

1. Update `.github/ISSUE_TEMPLATE/create-org-teams.yml` so it preserves the existing manual `requested_team_names` field, removes the textarea bulk CSV path from the new request flow, and adds an explicit `intake_mode` selector with `manual` and `csv_attachment` values.
2. Keep `.github/workflows/create-org-teams.yml` as the thin GitHub-required shim and extend its `issues` and `issue_comment` event handling so validation can distinguish initial issue submission from requester attachment-comment processing.
3. Extend `parse-team-creation-request.*` to derive `intake_mode`, keep manual normalization unchanged, and model `csv_attachment` requests as waiting for attachment until a qualifying requester comment is accepted.
4. Add shared attachment discovery, attachment download, and provenance helpers under `src/workflow-support/` so the workflow can resolve exactly one qualifying CSV attachment from requester-authored comments on the same issue.
5. Reuse the existing CSV team normalization semantics from feature `007` by validating accepted attachment content through the same row-level model, including the `team_name` header requirement and 1-based data-row numbering that excludes the header row.
6. Update `validate-team-creation-request.*` so it enforces requester-only attachment acceptance, deterministic later-comment correction after failed CSV validation, and terminal-state ignore behavior after approved execution completes.
7. Reuse the existing intended-owner approval gate so approval remains required after attachment validation succeeds and before any team creation mutation occurs.
8. Reuse the existing reconciliation and execution path so current team state is re-read with bounded retry, only missing teams are created, and already-satisfied teams remain no-op.
9. Preserve dry-run behavior for attachment-derived requests so approved dry-run executions stop before mutation while keeping attachment provenance visible in the audit artifact and summary.
10. Persist terminal attachment state durably by restoring prior per-issue audit artifacts on fresh runners (via `restore-request-audit-artifact.js` using the GitHub Actions artifacts API with `actions: read` permission) and by applying an operation-aware terminal-state issue label (`issueops:create-org-teams:{executed|partially_executed|failed}`) so later requester attachment comments are ignored through both the label-based and artifact-based detection paths.
11. Extend audit artifacts and requester-facing summaries to report waiting-for-attachment state, attachment provenance, duplicate rows, invalid rows, row-level CSV findings, and any captured attachment download rate-limit context.
12. Add parser fixture, contract, and integration coverage for manual non-regression, waiting-state behavior, requester-only attachment acceptance, corrected second-comment flows, dry-run preservation, bounded retry, and terminal-state ignore behavior.

## Validation Scenarios

### Scenario 1: Manual-path non-regression

1. Submit a create-org-teams request using `manual` intake mode and only the existing `requested_team_names` field.
2. Confirm validation, approval, reconciliation, and final reporting remain equivalent to the baseline behavior from feature `003-create-org-teams`.
3. Confirm no attachment comment is required.

### Scenario 2: Waiting for attachment

1. Submit a create-org-teams request using `csv_attachment` intake mode with valid request metadata and no attachment comment yet.
2. Confirm validation derives `intake_mode=csv_attachment`, records a waiting-for-attachment state, and does not request approval.
3. Confirm no team creation is attempted.

### Scenario 3: Valid requester attachment comment

1. Submit a `csv_attachment` request for an existing target organization and intended owner.
2. Post a requester-authored issue comment containing exactly one valid CSV attachment with a `team_name` header and multiple rows.
3. Confirm validation downloads the attachment, records attachment provenance, normalizes the rows into one requested-team list, and marks the request approval-ready.
4. Approve as the intended owner.
5. Confirm missing teams are created and the result summary records the intake mode, attachment provenance, CSV row counts, and mutation counts.

### Scenario 3A: Approved attachment request in dry-run mode

1. Submit a `csv_attachment` request with `dry_run=true`.
2. Post a valid requester-authored CSV attachment comment and approve as the intended owner.
3. Confirm the approved execution step stops before team creation.
4. Confirm the summary still records the attachment provenance and states that the request remains dry-run only.

### Scenario 4: Invalid or ambiguous attachment intake

1. Submit a `csv_attachment` request and post a comment that contains no attachment, multiple CSV attachments, a non-CSV attachment, or an oversized attachment.
2. Confirm the workflow fails closed before approval or mutation.
3. Confirm the summary explains why the attachment was not accepted and keeps the request blocked.

### Scenario 5: Invalid CSV content followed by corrected second comment

1. Submit a `csv_attachment` request and post a requester-authored CSV attachment whose content omits the `team_name` header, contains malformed rows, duplicate or conflicting names, or unsupported columns.
2. Confirm validation fails before approval or mutation and reports row-level findings.
3. Post a corrected CSV attachment in a later requester comment.
4. Confirm the workflow uses the newest eligible requester attachment comment that appears after the latest failed CSV-attachment validation result.
5. Confirm the corrected attachment supersedes the earlier failed attempt and can advance the request to approval readiness.

### Scenario 6: Non-requester comment rejection

1. Submit a `csv_attachment` request.
2. Post a CSV attachment comment from a user other than the original requester.
3. Confirm the workflow ignores that comment for attachment acceptance and leaves the request blocked.

### Scenario 7: Post-terminal-state ignore behavior

1. Approve and execute a valid attachment-driven request.
2. Post another requester-authored CSV attachment comment after the request has reached an executed terminal state.
3. Confirm no new validation, approval, or execution cycle begins and the completed request remains closed for reprocessing.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/create-org-teams-csv-attachment-workflow.yaml](./contracts/create-org-teams-csv-attachment-workflow.yaml) covers manual-path preservation, attachment-intake validation, authorization, reconciliation, and observability behavior.
- The design preserves the baseline `003-create-org-teams` approval-gated reconciliation path while superseding the textarea bulk-input path from feature `007` with attachment-based intake that preserves the same CSV validation semantics.
- Tests cover manual non-regression, waiting-for-attachment behavior, requester-only attachment acceptance, invalid attachment rejection, UTF-8 decode and size-cap failures, invalid CSV correction through a second comment, dry-run preservation, bounded retry handling, mixed create-or-no-op execution, and terminal-state ignore behavior.