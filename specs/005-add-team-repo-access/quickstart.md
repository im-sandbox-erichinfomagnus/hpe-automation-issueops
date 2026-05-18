# Quickstart: Add Team Repository Access Workflow

## Goal

Operate and validate the proposed add-team-repo-access IssueOps workflow across
request intake, central approval, repository-access reconciliation, and
auditable execution outcomes.

## Prerequisites

- A repository with GitHub issue forms enabled.
- Access to create or review issues in the central administration repository.
- A target GitHub organization available for validation scenarios.
- A PAT with sufficient organization and repository permissions, stored as a repository or organization secret named `ISSUEOPS_GITHUB_TOKEN`.
- An existing target team in the target organization.
- One or more existing target repositories in the same organization.
- A designated target organization owner who is authorized to approve the full request batch.

## Proposed Workflow Path

1. Create `.github/ISSUE_TEMPLATE/add-team-repo-access.yml` with fields for target organization, requested team, designated access approver login, requested repositories, one requested repository permission level, business justification, and dry-run preference.
2. Trigger `.github/workflows/add-team-repo-access.yml` from issue creation, issue comment activity, or manual replay.
3. Parse the issue body with `issue-ops/parser@v5`, pass the parser JSON output to the validation runner, and normalize the requested team, repositories, and permission level.
4. Use the repository's staged workflow pattern:
   - validation runner: `src/scripts/run-request-validation.js`
   - approval runner: `src/scripts/run-approval-gate.js`
   - execution runner: `src/scripts/run-approved-execution.js`
   - audit artifact path pattern: `artifacts/add-team-repo-access-validation-<issue>.json`
5. Run validation before mutation:
   - Confirm the target organization is visible to the workflow identity.
   - Confirm the requested team exists in the target organization.
   - Confirm each requested repository exists in the same target organization.
   - Confirm duplicate and conflicting repository identifiers are rejected.
   - Confirm the requested permission level normalizes to one supported repository role.
   - Confirm the designated access approver is an active organization owner in the target organization.
   - Confirm archived repositories and weaker existing permission conflicts are rejected.
   - Confirm no repository creation, permission removal, branch protection, or team membership inputs are present.
6. Assign the central issue to a central-repository owner for queue visibility.
7. Have the designated access approver add an issue comment containing exactly `approved` in the central repository to authorize the request.
8. Load the PAT-backed workflow token from `ISSUEOPS_GITHUB_TOKEN` for validation, approval checks, and repository team-permission mutation while preserving the repository-scoped `github.token` for standard Actions context.
9. Re-read current repository access state, classify repositories as `grant`, `noop`, or `reject`, and grant only the missing eligible access for the requested team.
10. Publish the GitHub step summary and upload the audit artifact with request, assignment, validation, approval, reconciliation, execution, and metadata sections.

## Validation Scenarios

### Scenario 1: Happy path for new repository grants

1. Submit a request for one existing team and two repositories in an existing target organization with one requested permission level and dry run disabled.
2. Confirm validation passes and the workflow waits for approval.
3. Approve as the designated target organization owner in the central repository.
4. Confirm the team receives the requested permission on both repositories and the result summary records two successful grants.

### Scenario 2: Mixed grant and exact-permission no-op

1. Submit a request where one requested repository already grants the team the exact requested permission and one repository does not.
2. Approve as the designated organization owner.
3. Confirm the workflow grants access only on the missing repository.
4. Confirm the summary records one applied grant and one no-op.

### Scenario 3: Stronger existing permission remains no-op

1. Submit a request where the team already has a stronger permission than requested on one repository.
2. Approve as the designated organization owner.
3. Confirm the workflow does not downgrade the stronger permission.
4. Confirm the summary records the repository as already satisfied or no-op.

### Scenario 4: Weaker existing permission conflict is rejected

1. Submit a request where the team already has a weaker repository permission than requested on one repository.
2. Confirm validation rejects that repository before approval or mutation.
3. Confirm the requester-facing summary explains that modifying weaker existing access is out of scope for this workflow version.

### Scenario 5: Archived repository blocked

1. Submit a request that includes an archived repository.
2. Confirm validation fails before approval or mutation.
3. Confirm the summary reports the repository as ineligible for access mutation in this feature version.

### Scenario 6: Idempotent re-run

1. Re-run a previously approved successful request.
2. Confirm no duplicate repository grants occur.
3. Confirm the result summary reports all requested repositories as already satisfied or no-op.
4. Confirm the summary records `Granted repositories: 0` and preserves the existing approval and assignment notes.

### Scenario 7: Partial failure or rate-limit path

1. Simulate a transient API throttle or one failing repository grant.
2. Confirm bounded retry behavior for retryable responses.
3. Confirm partial success is captured with explicit operator follow-up guidance.
4. Confirm the audit artifact preserves `rate_limit_snapshot`, `failed_subset`, and `remediation_instructions` when the run is not fully successful.

## Manual Validation Status

- Validated manually for request intake, approval gating, approved execution, idempotent rerun, and mixed grant/no-op behavior.
- Manual validation confirmed that central assignment remains routing-only, only the designated active target organization owner can approve, and approved execution grants only missing eligible repository access.
- Manual validation for partial-failure and rate-limit paths remains deferred; those behaviors are covered by repository-local automated tests.

## Exit Criteria

- All constitution check items in [plan.md](./plan.md) remain satisfied.
- The contract in [contracts/add-team-repo-access-workflow.yaml](./contracts/add-team-repo-access-workflow.yaml) covers parser, authorization, reconciliation, and observability behavior.
- The design supports a dry-run path, a privileged approval gate, and a reconciliation-first repository-access mutation path.
- The request surface excludes repository creation, repository-setting changes, team creation, team membership changes, permission removal, and permission downgrades.
- Manual replay through `workflow_dispatch` with an existing issue number reproduces the same approval and execution outcomes as issue-triggered runs.
