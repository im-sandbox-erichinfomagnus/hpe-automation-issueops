# Quickstart: Add Child Teams Workflow

## Goal

Operate and validate the proposed add-child-teams IssueOps workflow across
request intake, central approval, hierarchy reconciliation, and auditable
execution outcomes.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the central administration repository.
- A target GitHub organization available for validation scenarios.
- A PAT with sufficient organization permissions, stored as a repository or
  organization secret named `ISSUEOPS_GITHUB_TOKEN`.
- An existing target parent team and one or more existing target child teams in
  the same organization.
- A designated hierarchy approver who is currently authorized to approve the
  requested parent-child links for the full request batch.

## Proposed Workflow Path

1. Create `.github/ISSUE_TEMPLATE/add-child-teams.yml` with fields for target
   organization, requested parent team, designated hierarchy approver login,
   requested child teams, business justification, and dry-run preference.
2. Trigger `.github/workflows/add-child-teams.yml` from issue creation, issue
   comment activity, or manual replay.
3. Parse the issue body with `issue-ops/parser@v5`, pass the parser JSON output
   to the validation runner, and normalize requested parent and child-team
   identifiers.
4. Use the reserved runner and artifact conventions introduced by the workflow
   scaffold:
   - validation runner: `src/scripts/run-request-validation.js`
   - approval runner: `src/scripts/run-approval-gate.js`
   - execution runner: `src/scripts/run-approved-execution.js`
   - validation artifact path pattern: `artifacts/add-child-teams-validation-<issue>.json`
5. Run validation before mutation:
   - Confirm the target organization is visible to the workflow identity.
   - Confirm the requested parent team exists.
   - Confirm each requested child team exists in the same target organization.
   - Confirm duplicate and conflicting child-team identifiers are rejected.
   - Confirm the designated hierarchy approver is valid for the requested parent
     and child teams.
   - Confirm no re-parenting or cycle-creating requests are present.
   - Confirm no team-creation, team-deletion, member-management, or
     repository-permission inputs are present.
6. Assign the central issue to a central-repository owner for queue visibility.
7. Have the designated hierarchy approver add an issue comment containing
   exactly `approved` in the central repository to authorize the request.
8. Load the PAT-backed workflow token from `ISSUEOPS_GITHUB_TOKEN` for
   validation, approval checks, and hierarchy mutation while preserving the
   repository-scoped `github.token` for standard Actions context.
9. Re-read current parent and child-team hierarchy state, classify existing
   links as no-op, and attach only missing child teams to the requested parent.
10. Publish the GitHub step summary and upload the audit artifact with request,
   assignment, validation, approval, reconciliation, execution, and metadata
   sections.

## Validated End-to-End Outcomes

- Validation-only reruns keep the request in `awaiting_approval`, preserve
   `Central assignment: assigned`, and report that no child-team mutation was
   attempted.
- Approved mixed batches report the exact split between `Child links applied`
   and `No-op`, proving that only missing child links mutate.
- Approved reruns against already-satisfied hierarchy state remain
   `Request status: executed` with `Child links applied: 0` and all requested
   child teams counted as no-op.
- Assignment and approval notes remain operation-specific: central assignment is
   queue ownership only, and approval is attributed to the designated hierarchy
   approver for the batch.

## Validation Scenarios

### Scenario 1: Happy path for new child links

1. Submit a request for one parent team and two child teams in an existing
   target organization with one designated hierarchy approver and dry run
   disabled.
2. Confirm validation passes and the workflow waits for approval.
3. Approve as the designated hierarchy approver in the central repository.
4. Confirm both child teams are attached under the parent and the result summary
   records two successful hierarchy mutations.

### Scenario 2: Mixed link and no-op

1. Submit a request where one requested child team is already attached to the
   requested parent and one child team is not.
2. Approve as the designated hierarchy approver.
3. Confirm the workflow links only the missing child team.
4. Confirm the summary records one applied link and one no-op.
5. Confirm the summary keeps `Request status: executed` and `Rollback status: not_needed`.

### Scenario 3: Re-parenting blocked

1. Submit a request where one requested child team is currently attached to a
   different parent team.
2. Confirm validation fails before approval or mutation.
3. Confirm the requester-facing summary explains that automatic re-parenting is
   out of scope for this workflow version.

### Scenario 4: Cycle blocked

1. Submit a request where one requested child team is already an ancestor of the
   requested parent team.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary reports that the request would create a hierarchy cycle.

### Scenario 5: Idempotent re-run

1. Re-run a previously approved successful request.
2. Confirm no duplicate hierarchy mutations occur.
3. Confirm the result summary reports all requested child teams as already
   satisfied or no-op.
4. Confirm the summary records `Child links applied: 0` and preserves the
   existing approval and assignment notes.

### Scenario 6: Partial failure or rate-limit path

1. Simulate a transient API throttle or one failing hierarchy mutation.
2. Confirm bounded retry behavior for retryable responses.
3. Confirm partial success is captured with explicit operator follow-up
   guidance.
4. Confirm the audit artifact preserves `rate_limit_snapshot`, `failed_subset`,
   and `remediation_instructions` when the run is not fully successful.

## Manual Validation Status

- Approval-ready validation path: manually validated.
- Approval granted path: manually validated.
- Mixed execution path with one applied link and one no-op: manually validated.
- Idempotent rerun path with zero applied links and all no-op: manually validated.
- Partial failure and retryable throttle paths: covered by automated tests and
  still optional for live manual simulation.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/add-child-teams-workflow.yaml](./contracts/add-child-teams-workflow.yaml)
  covers parser, authorization, reconciliation, and observability behavior.
- The design supports a dry-run path, a privileged approval gate, and a
  reconciliation-first hierarchy mutation path.
- The request surface excludes team creation, team deletion, member-management,
  and repository-permission changes.