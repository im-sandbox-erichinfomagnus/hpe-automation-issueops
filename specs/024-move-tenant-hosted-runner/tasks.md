# Tasks: Move Tenant GitHub-Hosted Runner

## Setup

- [x] T001 Add the spec-kit document set under `specs/024-move-tenant-hosted-runner/`.
- [x] T002 Add the issue form and workflow.
- [x] T003 Add a representative issue fixture.

## Validation

- [x] T004 Add the move request parser with optional runner id handling.
- [x] T005 Add tenant, runner, target group, and approver validation.
- [x] T006 Reject missing, ambiguous, id-mismatched, and cross-tenant targets.
- [x] T007 Add no-op detection for already-satisfied placement.
- [x] T008 Add the move reconciler.
- [x] T009 Register move detection in the shared validation runner.

## Approval

- [x] T010 Register `hosted_runner_move` in the context-bound tenant runner approval modes.
- [x] T011 Reuse the hosted-runner approver resolver and mutation policy.
- [x] T012 Add queue-assignment and approval summary text.

## Execution

- [x] T013 Add `updateHostedRunner` to the GitHub runner API.
- [x] T014 Revalidate runner and group state after approval.
- [x] T015 Execute bounded-retry PATCH only for `move_hosted_runner`.
- [x] T016 Add move outcome, audit, summary, and terminal label fields.
- [x] T017 Post the formatted result to the issue.

## Tests

- [x] T018 Add parser and validation contract tests.
- [x] T019 Add PATCH request-shape coverage.
- [x] T020 Add integration coverage for move, no-op, and boundary mismatch.
- [x] T021 Run the full repository test suite and compare failures with main.
- [x] T022 Run actionlint for all workflows.
- [x] T023 Commit and push the branch and update PR #27.
