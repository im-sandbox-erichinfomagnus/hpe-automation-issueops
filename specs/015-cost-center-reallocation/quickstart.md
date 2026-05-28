# Quickstart: Cost Center Reallocation Workflow

## Goal

Operate and validate the proposed cost-center-reallocation IssueOps workflow
across request intake, central approval, reconciliation, and auditable execution
outcomes, with a default dry-run path that works before enterprise billing
access is in place.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the central administration repository.
- A target enterprise available for validation scenarios.
- For live execution, a PAT with enterprise billing or admin access, stored as a
  repository or organization secret named `ISSUEOPS_GITHUB_TOKEN`.
- A named intended approver who will comment exactly `approved` on the request.

## Current Implementation Status

The cost-center-reallocation workflow is specified end to end for this feature
scope:

- `.github/ISSUE_TEMPLATE/cost-center-reallocation.yml` captures the enterprise, the named intended approver, the assignments CSV, a business justification, and a dry-run choice.
- `.github/workflows/cost-center-reallocation.yml` resolves issue context, validates requests, evaluates named-approver approval, executes approved reconciliation, and uploads the audit artifact.
- `src/scripts/run-cost-center-validation.js`, `src/scripts/run-cost-center-approval.js`, and `src/scripts/run-cost-center-execution.js` provide the validation, approval, reconciliation, and mutation stages.
- Requests are limited to user resources only. Organization and repository resource types, cost center deletion, and GitHub App migration remain out of scope.

## Proposed Workflow Path

1. Create `.github/ISSUE_TEMPLATE/cost-center-reallocation.yml` with fields for
   enterprise, intended approver, assignments CSV, business justification, and
   dry-run preference.
2. Trigger `.github/workflows/cost-center-reallocation.yml` from issue creation,
   issue comment activity, or manual replay.
3. Parse the issue body with `issue-ops/parser@v5`, pass the parser JSON output
   to the validation runner, and normalize the assignments CSV into rows.
4. Run validation before mutation:
   - Confirm the enterprise slug is present and well formed.
   - Confirm the CSV header is `cost_center,login,action` and at least one row is
     well formed.
   - Confirm duplicate and conflicting rows are rejected and the default `add`
     action is applied.
   - Confirm no organization or repository resource input is present.
   - Confirm live cost center state when a billing token is available, otherwise
     mark live state unverified.
5. Have the named intended approver add an issue comment containing exactly
   `approved` in the central repository to authorize the request.
6. Load the PAT-backed workflow token from `ISSUEOPS_GITHUB_TOKEN` for live
   state reads and the mutation phase while preserving the repository-scoped
   `github.token` for standard Actions context.
7. Re-read current enterprise cost center state, classify each row as create,
   add, remove, or no-op, and apply only the required changes when not a dry run.
8. Publish the GitHub step summary and upload the audit artifact with request,
   validation, live-state verification, approval, reconciliation, execution, and
   metadata sections.
9. Surface the operational note that the enterprise billing token is the known
   blocker, so the default is dry-run until that token is available.

## Validation Scenarios

### Scenario 1: Happy path for new cost centers and adds

1. Submit a request for two new cost centers with add rows in an enterprise and
   dry run disabled.
2. Confirm validation passes and the workflow waits for approval.
3. Approve as the named intended approver in the central repository.
4. Confirm both cost centers are created, the users are added, and the result
   summary records the mutations.

### Scenario 2: Mixed create, add, remove, and no-op

1. Submit a request where one cost center already exists, one is missing, some
   add rows are already satisfied, and one remove row applies.
2. Approve as the named intended approver.
3. Confirm the workflow creates only the missing cost center and applies only the
   required adds and removes.
4. Confirm the summary records create, add, remove, and no-op counts.

### Scenario 3: Degraded live state without a billing token

1. Submit a valid request while no enterprise billing token is available.
2. Confirm structural CSV validation passes and live state is marked unverified.
3. Confirm the summary reports a dry-run plan and notes that live cost center
   state could not be confirmed.

### Scenario 4: Out-of-scope resource input

1. Submit a request that includes organization or repository resource lines.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary states that this workflow handles user resources only.

### Scenario 5: Invalid approval

1. Submit a valid request and have a user who is not the named intended approver
   comment `approved`, or have the named approver comment something other than
   `approved`.
2. Confirm the workflow does not unlock execution.
3. Confirm the request remains blocked with a clear approval-required outcome.

### Scenario 6: Idempotent re-run

1. Re-run a previously approved successful request.
2. Confirm no duplicate cost center creation or redundant membership changes
   occur.
3. Confirm the result summary reports all rows as already satisfied or no-op.

### Scenario 7: Partial failure or rate-limit path

1. Simulate a transient API throttle or one failing resource change.
2. Confirm bounded retry behavior for retryable responses.
3. Confirm partial success is captured with explicit operator follow-up
   guidance.

## Verified Checks

- Automated validation covers CSV normalization, default action application,
  duplicate and conflicting row rejection, unknown action rejection, named
  approver approval, out-of-scope resource input, create, add, remove, no-op
  rerun, degraded live-state handling, partial failure, and bounded retry
  handling.
- Live manual validation requires the enterprise billing token; until it is
  available, the dry-run plan path is the validated surface.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/cost-center-reallocation-workflow.yaml](./contracts/cost-center-reallocation-workflow.yaml)
  covers parser, authorization, reconciliation, and observability behavior.
- The design supports a default dry-run path, a privileged approval gate, and a
  reconciliation-first cost center path.
- The request surface contains no organization or repository resource fields
  because those resource types are deferred to a later enhancement.
- Operator-facing summaries explain that the enterprise billing token is the
  known blocker and that live state is marked unverified when it is absent.
