# Quickstart: Tenant GitHub-Hosted Runner Deletion IssueOps Workflow

## Goal

Delete one tenant-prefixed GitHub-hosted runner in a target organization through an approval-gated, auditable IssueOps request authorized by tenant topology admin membership.

## Prerequisites

- A tenant registry record exists under `tenant-registry/` for the target organization (created by the 014 tenant bootstrap workflow).
- The canonical tenant topology admin team (`<tenant-slug>-admin`) exists in the target organization and the requester is an active member.
- A repository or organization Actions secret named `ISSUEOPS_GITHUB_TOKEN` backed by a PAT with hosted-runner administration permission.
- A designated approver who is an active owner of the target organization.

## Setup Verification

1. Confirm `tenant-registry/<tenant_key>.json` exists on `main` and its `organization` matches the target organization.
2. Confirm the `<tenant-slug>-admin` team exists and the requester is an active member.
3. Confirm the target runner appears in the organization's hosted-runner list with the tenant prefix.

## Workflow Path

1. Open the issue form `Delete tenant GitHub-hosted runner` under `.github/ISSUE_TEMPLATE/delete-tenant-hosted-runner.yml`.
2. Submit target organization, tenant name, runner name (full or base), designated approver, dry-run flag, and justification.
3. The `delete-tenant-hosted-runner` workflow validates the request and resolves the live runner identifier, publishing an audit artifact plus step summary.
4. The designated approver comments exactly `approved` on the issue.
5. The workflow revalidates boundary state and deletes the runner only when present.
6. Review the final workflow summary, terminal-state label, and uploaded artifact.

## Validated Scenario Runbook

### Scenario 1: Happy path (runner deleted)

**Preconditions**: Tenant context valid; the derived runner exists.

1. Submit the issue form with dry-run `false`.
2. Designated approver comments `approved`.

- Request status becomes `executed`; `runner_deletion_result` is `deleted`.

### Scenario 2: Runner already absent (no-op)

**Preconditions**: No runner with the derived name exists.

1. Submit the issue form; validation warns about no-op convergence.
2. Approve and execute.

- Request status becomes `executed` with a no-op outcome and no deletion call.

### Scenario 3: Requester not a topology admin member

1. Submit the issue form from a non-member account.

- Validation fails with an explicit authorization error; no mutation occurs.

### Scenario 4: Dry-run

1. Submit with dry-run `true` and approve.

- The plan reports the deletion intent; no runner is deleted.

### Scenario 5: Unauthorized approval comment

1. A user other than the designated approver comments `approved`.

- Approval is denied; execution remains blocked.

### Scenario 6: Boundary mismatch at execution

**Preconditions**: Request approved, then requester removed from the topology admin team.

1. Re-run the workflow for the approved issue.

- Boundary revalidation reports `mismatched`; mutation is blocked.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Validation error: no authorized tenant context | Tenant name mismatch or requester lacks topology admin membership | Verify the registry record and the requester's active membership on `<tenant-slug>-admin` |
| Validation warning: runner not found | Runner already deleted or name typo | Confirm the runner name; rerun is safe (no-op) |
| Deletion fails with 403 | Token lacks hosted-runner administration permission | Update `ISSUEOPS_GITHUB_TOKEN` scopes |
| Execution blocked: boundary_mismatch | Governance state changed after approval | Re-validate by editing the issue; obtain fresh approval |
| Need the runner back after deletion | Deletion is not reversible | Re-create it through the create-tenant-hosted-runner workflow |
