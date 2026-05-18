# Quickstart: Create Organization Teams Workflow

## Goal

Operate and validate the proposed create-org-teams IssueOps workflow across
request intake, central approval, reconciliation, and auditable execution
outcomes.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the central administration repository.
- A target GitHub organization available for validation scenarios.
- A PAT with sufficient organization permissions, stored as a repository or
  organization secret named `ISSUEOPS_GITHUB_TOKEN`.
- A target organization member designated as the intended owner for the teams in
  a request batch.

## Current Implementation Status

The create-org-teams workflow is implemented end to end for this feature scope:

- `.github/ISSUE_TEMPLATE/create-org-teams.yml` captures the target organization, a single shared intended owner, requested team names, business justification, and dry-run choice.
- `.github/workflows/create-org-teams.yml` resolves issue context, validates requests, assigns the central issue for queue ownership, evaluates intended-owner approval, executes approved team creation, and uploads the audit artifact.
- `src/scripts/run-request-validation.js`, `src/scripts/run-approval-gate.js`, and `src/scripts/run-approved-execution.js` provide the validation, approval, reconciliation, and mutation stages.
- Requests are limited to empty-team creation only. Parent-team input, member-population input, and maintainer-management follow-up remain out of scope.

## Proposed Workflow Path

1. Create `.github/ISSUE_TEMPLATE/create-org-teams.yml` with fields for target
   organization, intended owner login, requested team names, business
   justification, and dry-run preference.
2. Trigger `.github/workflows/create-org-teams.yml` from issue creation, issue
   comment activity, or manual replay.
3. Parse the issue body with `issue-ops/parser@v5`, pass the parser JSON output
   to the validation runner, and normalize the requested team names into slugs.
4. Run validation before mutation:
   - Confirm the target organization is visible to the workflow identity.
   - Confirm at least one requested team is present.
   - Confirm duplicate and conflicting slugs are rejected.
   - Confirm the intended owner is an active member of the target organization.
   - Confirm no team member names or parent-team inputs are present.
5. Assign the central issue to a central-repository owner for queue visibility.
6. Have the intended owner add an issue comment containing exactly `approved`
   in the central repository to authorize the request.
7. Load the PAT-backed workflow token from `ISSUEOPS_GITHUB_TOKEN` for
   validation, approval checks, and the mutation phase while preserving the
   repository-scoped `github.token` for standard Actions context.
8. Re-read current target organization team state, classify existing teams as
   no-op, and create only missing teams.
9. Publish the GitHub step summary and upload the audit artifact with request,
   assignment, validation, approval, reconciliation, execution, and metadata
   sections.
10. Surface the operational note that GitHub automatically makes the
    authenticated creator a team maintainer when a new team is created.

## Validation Scenarios

### Scenario 1: Happy path for new empty teams

1. Submit a request for two new team names in an existing target organization
   with a single intended owner and dry run disabled.
2. Confirm validation passes and the workflow waits for approval.
3. Approve as the intended owner in the central repository.
4. Confirm both teams are created and the result summary records two mutations.

### Scenario 2: Mixed create and no-op

1. Submit a request where one requested team already exists and one requested
   team is missing.
2. Approve as the intended owner.
3. Confirm the workflow creates only the missing team.
4. Confirm the summary records one create and one no-op.

### Scenario 3: Invalid mixed-owner batch

1. Submit a request that implies different intended owners across the requested
   teams.
2. Confirm validation fails before approval or mutation.
3. Confirm the requester-facing summary directs the requester to split the batch
   into separately approvable requests.

### Scenario 4: Out-of-scope member population input

1. Submit a request that includes team member usernames or member-population
   instructions.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary states that this workflow only creates empty teams.

### Scenario 5: Out-of-scope parent-team input

1. Submit a request payload that attempts to specify a parent team.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary reports that parent-team configuration is out of scope
   for this workflow version.

### Scenario 6: Idempotent re-run

1. Re-run a previously approved successful request.
2. Confirm no duplicate team creations occur.
3. Confirm the result summary reports all requested teams as already satisfied
   or no-op.

### Scenario 7: Partial failure or rate-limit path

1. Simulate a transient API throttle or one failing team creation.
2. Confirm bounded retry behavior for retryable responses.
3. Confirm partial success is captured with explicit operator follow-up
   guidance.

## Verified Checks

- Automated validation covers parser normalization, mixed-owner rejection,
  intended-owner approval, out-of-scope parent-team and member input, create,
  no-op rerun, partial failure, and bounded retry handling.
- Live manual validation on 2026-05-15 confirmed successful team creation and
  no-op behavior on rerun for the same approved request.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/create-org-teams-workflow.yaml](./contracts/create-org-teams-workflow.yaml)
  covers parser, authorization, reconciliation, and observability behavior.
- The design supports a dry-run path, a privileged approval gate, and a
  reconciliation-first team-creation path.
- The request surface contains no team member fields because team membership is
  handled by a separate IssueOps workflow.
- Operator-facing summaries explain that the authenticated creator becomes a
   team maintainer as a GitHub API constraint when team creation succeeds.