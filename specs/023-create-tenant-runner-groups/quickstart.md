# Quickstart: Tenant Runner Group Creation IssueOps Workflow

## Goal

Create one tenant-prefixed Actions runner group in a target organization through an approval-gated, auditable IssueOps request authorized by tenant CI/CD admin membership.

## Prerequisites

- A tenant registry record exists under `tenant-registry/` for the target organization (created by the 014 tenant bootstrap workflow).
- The derived tenant CI/CD admin team (`TenantName_CICDAdmins`) exists in the target organization and the requester is an active member.
- A repository or organization Actions secret named `ISSUEOPS_GITHUB_TOKEN` backed by a PAT with runner-group administration permission (`admin:org` classic scope or equivalent fine-grained permission).
- A designated approver who is an active owner of the target organization.
- The organization is on a plan that supports organization-level runner groups.

## Setup Verification

1. Confirm `tenant-registry/<tenant_key>.json` exists on `main` and its `organization` matches the target organization.
2. Confirm the `TenantName_CICDAdmins` team exists and the requester is an active member.
3. Confirm `ISSUEOPS_GITHUB_TOKEN` is configured and PAT-backed.

## Workflow Path

1. Open the issue form `Create tenant runner group` under `.github/ISSUE_TEMPLATE/create-tenant-runner-groups.yml`.
2. Submit target organization, tenant name, group base name, optional visibility (defaults to `selected`), optional public-repository allowance (defaults to false), designated approver, dry-run flag, and justification.
3. The `create-tenant-runner-groups` workflow validates the request and publishes an audit artifact plus step summary.
4. The designated approver comments exactly `approved` on the issue.
5. The workflow revalidates boundary state and creates the group only when missing.
6. Review the final workflow summary, terminal-state label, and uploaded artifact.

## Validated Scenario Runbook

### Scenario 1: Happy path (group created)

**Preconditions**: Tenant context valid; no group with the derived name exists.

1. Submit the issue form with dry-run `false`.
2. Designated approver comments `approved`.

- Request status becomes `executed`; `runner_group_creation_result` is `created` with the new group id.
- The derived group name carries the tenant prefix; visibility is `selected` unless overridden.

### Scenario 2: Existing group no-op

**Preconditions**: A runner group with the derived name already exists.

1. Submit, approve, and execute.

- Reconciliation reports `noop`; no duplicate group is created.

### Scenario 3: Requester not a CI/CD admin member

1. Submit the issue form from a non-member account.

- Validation fails with an explicit authorization error; no mutation occurs.

### Scenario 4: Dry-run

1. Submit with dry-run `true` and approve.

- The plan reports `create_runner_group` intent; no group is created.

### Scenario 5: Invalid visibility

1. Submit with a visibility value outside selected/all/private.

- Validation fails with an explicit finding.

### Scenario 6: Boundary mismatch at execution

**Preconditions**: Request approved, then requester removed from the CI/CD admin team.

1. Re-run the workflow for the approved issue.

- Boundary revalidation reports `mismatched`; mutation is blocked.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Validation error: no authorized tenant context | Tenant name mismatch or requester lacks CI/CD admin membership | Verify the registry record and the requester's active membership on `TenantName_CICDAdmins` |
| Validation error: derived group name invalid | Base name empty after normalization or oversized derivation | Shorten the base name; use letters, digits, `.`, `-`, `_` |
| Creation fails with 403 | Token lacks runner-group administration permission | Update `ISSUEOPS_GITHUB_TOKEN` scopes (`admin:org`) |
| Creation fails with 404/422 on plan limits | Organization plan does not support org runner groups | Confirm GHEC/Team plan for the target organization |
| Execution blocked: boundary_mismatch | Governance state changed after approval | Re-validate by editing the issue; obtain fresh approval |
| Group exists with different visibility | Pre-existing group; creation converges as no-op | Visibility updates are a separate operation; review the drift warning in the summary |
