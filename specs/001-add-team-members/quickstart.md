# Quickstart: Add Team Members Workflow

## Goal

Operate and validate the implemented add-team-members IssueOps workflow across
request intake, approval, reconciliation, and auditable execution outcomes.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the repository.
- A target GitHub organization and team available for validation scenarios.
- An organization owner available to exercise the approval gate.
- A PAT with sufficient organization permissions, stored as a repository or
   organization secret for workflow use.

## Phase 1 Baseline

- The workflow entrypoint runs on `ubuntu-latest` with `bash` as the default shell.
- Workflow linting is enforced by `.github/workflows/lint-workflows.yml` using `rhysd/actionlint`.
- The request workflow is serialized per issue via the `add-team-members-*` concurrency group.
- The initial scaffold uses `.github/workflows/add-team-members.yml` as a thin shim and defers substantive logic to later phases under `src/`.

## Proposed Workflow Path

1. Create `.github/ISSUE_TEMPLATE/add-team-members.yml` with fields for
   organization, team slug, requested people, business justification, and
   dry-run preference.
2. Trigger `.github/workflows/add-team-members.yml` from issue creation,
   issue comment activity, or manual replay.
3. Parse the issue body with `issue-ops/parser@v5`, pass the parser JSON output
   to the validation runner, and normalize the requested usernames.
4. Run validation before mutation:
   - Confirm the target team exists.
   - Confirm at least one requested person is present.
   - Resolve requested usernames.
   - Confirm no privileged mutation proceeds before approval.
5. Have an organization owner add an issue comment containing exactly
   `approved` to authorize the request.
6. Load the PAT-backed workflow token from secrets for the mutation phase.
7. Re-read current team membership, classify existing memberships as no-op, and
   add only missing users.
8. Publish the GitHub step summary and upload the audit artifact with request,
   validation, approval, reconciliation, execution, and metadata sections.

## Validation Scenarios

### Scenario 1: Happy path

1. Submit a request for an existing team with two valid users not currently on
   the team.
2. Confirm validation passes and the workflow waits for approval.
3. Approve as an organization owner.
4. Confirm both users are added and the result summary records two mutations.

### Scenario 1a: Mixed add and no-op

1. Submit a request for an existing team where one user is already a member and
   one user is missing, with dry run disabled.
2. Approve as an organization owner.
3. Confirm the result summary records one add and one no-op.
4. Confirm the artifact shows `request.request_status=executed` and preserves
   both requested usernames.

### Scenario 2: Missing team

1. Submit a request with a non-existent team slug.
2. Confirm validation fails before approval or mutation.
3. Confirm the requester-facing summary states that the target team must exist.

### Scenario 3: Idempotent re-run

1. Re-run the previously approved successful request.
2. Confirm no duplicate writes occur.
3. Confirm the result summary reports the users as already satisfied or no-op.

### Scenario 4: Missing approval

1. Submit a valid request and do not provide approval.
2. Confirm the workflow stops before any membership mutation.
3. Confirm the audit artifact records approval as pending or absent.

### Scenario 5: Rate-limit or partial failure path

1. Simulate a transient API throttle or one failing user add.
2. Confirm bounded retry behavior for retryable responses.
3. Confirm partial success is captured with explicit follow-up guidance.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/add-team-members-workflow.yaml](./contracts/add-team-members-workflow.yaml)
  covers parser, authorization, reconciliation, and observability behavior.
- The design supports a dry-run path, a privileged approval gate, and a
  reconciliation-first mutation path.
- Live validation on 2026-05-14 confirmed approval-ready intake, org-owner
   comment approval, and mixed add/no-op execution against the GitHub Actions
   workflow.