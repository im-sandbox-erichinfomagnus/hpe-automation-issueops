# Quickstart: Remove Team Repo Access Workflow

## Goal

Execute IssueOps requests that remove one team from one or more repositories using `manual` or `csv_attachment` intake while preserving governance and safety semantics from specs 005/009/013.

## Prerequisites

- Target organization and team are visible to workflow identity.
- `ISSUEOPS_GITHUB_TOKEN` is configured with required privileges for validation and repository-team permission mutation.
- Designated approver is active org owner in target organization.

## Workflow Path

1. Submit add/remove issue using intake mode `manual` or `csv_attachment`.
2. For `manual`, validate normalized repository list and block on errors.
3. For `csv_attachment`, request enters `waiting_for_attachment` until accepted requester CSV attachment candidate exists.
4. Validate attachment candidate (requester-only, deterministic selection, size/decode/schema checks).
5. Normalize repositories and emit row-level findings.
6. Transition to `awaiting_approval` only after validation passes.
7. Designated valid approver comments `approved`.
8. Reconciliation reads latest repository-team state and classifies each row: `remove_access` vs `noop_already_absent` vs `reject`.
9. Execute removal mutations only for `remove_access` rows (or no mutation in dry-run).
10. Emit per-repository outcomes and run summary artifact.
11. Preserve terminal-state immutability for later attachment comments.

## Operator Verification Runbook

1. Create `csv_attachment` request with valid metadata and no attachment.
2. Confirm status: `waiting_for_attachment`, approval blocked.
3. Post requester-authored valid CSV attachment comment.
4. Confirm status: `awaiting_approval`, row findings present.
5. Approve with designated approver.
6. Execute and verify mixed outcomes:
   - repositories with current access -> `removed`
   - repositories already absent -> `noop`
7. Re-run and verify idempotent no duplicate removals.
8. Post later requester attachment comment after terminal state and verify request remains terminal.

## Operator Scenario Matrix

1. Manual + dry-run + valid approver:
   - Expected status: `approved` after approval step.
   - Expected execution: no mutation calls, summary states dry-run/no mutation.
2. Manual + approved + mixed repository state:
   - Expected execution: only repositories with explicit access are removed.
   - Expected outcomes: `removed_count > 0` and `noop_count >= 0`.
3. csv_attachment + no accepted candidate:
   - Expected status: `waiting_for_attachment`.
   - Expected gate behavior: approval and execution remain blocked.
4. csv_attachment + terminal request + new comment:
   - Expected behavior: later attachment comments are ignored.
   - Expected metadata: `acceptance_status = ignored_terminal_state`.

## Local Verification Commands

- Workflow lint (entrypoint):
  - `docker run --rm -v "${PWD}:/repo" -w /repo rhysd/actionlint:latest .github/workflows/remove-team-repo-access.yml`
- Feature 020 contract tests:
  - `node --test tests/contract/remove-team-repo-access-*.test.js tests/contract/reconcile-team-repo-access-removal.test.js`
- Feature 020 integration tests:
  - `node --test tests/integration/remove-team-repo-access-*.test.js`

## Exit Criteria

- Manual mode remains non-regressive to baseline governance/validation.
- CSV attachment lifecycle enforces waiting/supersession/terminal immutability semantics.
- Reconciliation and execution are drift-aware and idempotent.
- Audit artifacts clearly show requester, approver, candidate provenance, per-repository outcomes, and remediation guidance.
