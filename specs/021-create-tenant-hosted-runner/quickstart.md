# Quickstart: Tenant GitHub-Hosted Runner Creation IssueOps Workflow

## Goal

Create one tenant-prefixed GitHub-hosted runner in a target organization through an approval-gated, auditable IssueOps request authorized by tenant CI/CD admin membership.

## Prerequisites

- A tenant registry record exists under `tenant-registry/` for the target organization (created by the 014 tenant bootstrap workflow).
- The derived tenant CI/CD admin team (`TenantName_CICDAdmins`) exists in the target organization and the requester is an active member.
- A repository or organization Actions secret named `ISSUEOPS_GITHUB_TOKEN` backed by a PAT with hosted-runner administration permission (`manage_runners:org` classic scope or equivalent fine-grained permission).
- A designated approver who is an active owner of the target organization.

## Setup Verification

1. Confirm `tenant-registry/<tenant_key>.json` exists on `main` and its `organization` matches the target organization.
2. Confirm the `TenantName_CICDAdmins` team exists in the target organization (derived from the registry `tenant_display_name`, whitespace to underscores, `_CICDAdmins` suffix).
3. Confirm the requester appears as an active member of that team.
4. Confirm `ISSUEOPS_GITHUB_TOKEN` is configured and PAT-backed.
5. Optionally list available images and machine sizes for the organization (`GET /orgs/{org}/actions/hosted-runners/images/github-owned`, `GET /orgs/{org}/actions/hosted-runners/machine-sizes`) to choose valid `runner_image_id` and `runner_size` values.

## Workflow Path

1. Open the issue form `Create tenant GitHub-hosted runner` under `.github/ISSUE_TEMPLATE/create-tenant-hosted-runner.yml`.
2. Submit target organization, tenant name, runner base name, image id, image source, machine size, optional runner group name, optional maximum runners, designated approver, dry-run flag, and justification.
3. The `create-tenant-hosted-runner` workflow validates the request (tenant resolution, CI/CD admin membership, name derivation, runner group resolution) and publishes an audit artifact plus step summary.
4. The designated approver comments exactly `approved` on the issue.
5. The workflow revalidates boundary state and creates the runner only when missing.
6. Review the final workflow summary, terminal-state label, and uploaded artifact for validation, approval, reconciliation, and execution results.

## Validated Scenario Runbook

### Scenario 1: Happy path (runner created)

**Preconditions**: Tenant registry record present; CI/CD admin team exists with requester as active member; no runner with the derived name exists.

1. Submit the issue form with dry-run `false`.
2. Wait for validation to mark the request `awaiting_approval`.
3. Designated approver comments `approved`.
4. Workflow executes and creates the runner.

- Request status becomes `executed`.
- `runner_creation_result` is `created` and `created_runner_id` is reported.
- The derived runner name carries the tenant prefix.

### Scenario 2: Requester not a CI/CD admin member

**Preconditions**: Requester is not an active member of `TenantName_CICDAdmins`.

1. Submit the issue form.

- Validation fails with an explicit authorization error.
- No approval is requested; no mutation occurs.

### Scenario 3: CI/CD admin team missing

**Preconditions**: The derived `TenantName_CICDAdmins` team does not exist.

1. Submit the issue form.

- Validation fails closed with remediation guidance to provision the team first.
- No mutation occurs.

### Scenario 4: Dry-run

**Preconditions**: Valid request context.

1. Submit the issue form with dry-run `true`.
2. Designated approver comments `approved`.

- Validation and reconciliation complete; the plan reports `create_hosted_runner` intent.
- No runner is created; the summary marks the run as dry-run.

### Scenario 5: Existing runner no-op

**Preconditions**: A hosted runner with the derived name already exists.

1. Submit the issue form with dry-run `false` and approve.

- Reconciliation reports `noop`; request status becomes `executed` with a no-op outcome.
- No duplicate runner is created.

### Scenario 6: Unauthorized approval comment

**Preconditions**: Valid request awaiting approval.

1. A user other than the designated approver comments `approved`.

- Approval is denied; execution remains blocked.

### Scenario 7: Tenant runner group targeting

**Preconditions**: A runner group named `TenantName_GroupName` exists.

1. Submit the issue form with the runner group name filled in.

- Validation resolves the group id; execution creates the runner in that group.
- A group name without the tenant prefix is rejected at validation.

### Scenario 8: Boundary mismatch at execution

**Preconditions**: Request approved, then requester removed from the CI/CD admin team before execution.

1. Re-run the workflow for the approved issue.

- Boundary revalidation reports `mismatched`; mutation is blocked with `boundary_mismatch`.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Validation error: no authorized tenant context | Tenant name does not match a registry record, or requester lacks CI/CD admin membership | Verify `tenant_display_name` in the registry record and the requester's active membership on `TenantName_CICDAdmins` |
| Validation error: CI/CD admin team missing | `TenantName_CICDAdmins` not provisioned | Provision the team through the tenant CI/CD admin governance process, then re-run |
| Validation error: derived runner name invalid | Base name empty after normalization or derived name over 64 characters | Shorten the base name; use only letters, digits, `.`, `-`, `_` |
| Validation error: runner group not found | Group name missing tenant prefix or group does not exist | Create the tenant runner group first (sibling feature) or omit the field to target the default group |
| Execution blocked: boundary_mismatch | Governance state changed after approval | Re-validate by editing the issue; obtain fresh approval |
| Creation fails with 403 | Token lacks hosted-runner administration permission | Update `ISSUEOPS_GITHUB_TOKEN` scopes (`manage_runners:org`) |
| Runner stuck in Provisioning | Platform-side provisioning delay | Check the runner in org settings; partial-failure remediation guidance lists the runner id |
