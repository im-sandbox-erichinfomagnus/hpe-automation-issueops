# Quickstart: Tenant Repository Creation IssueOps Workflow

## Goal

Create one repository per request inside the validated target organization under one canonical tenant context, grant admin permission to the tenant repo-admin team, and leave auditable evidence for validation, approval, execution, and failure handling.

## Prerequisites

- GitHub Issues and issue forms enabled in this repository.
- `ISSUEOPS_GITHUB_TOKEN` configured as a PAT with least-privilege permissions needed to:
  - read target organization, team hierarchy, requester membership, repository existence, and approver authority
  - create repositories in the target organization
  - grant team repository permissions
- `tenant-registry/` exists in the repository and the workflow can read authoritative tenant records from the main branch.
- Each tenant registry file (`tenant-registry/{tenant_key}.json`) must contain `tenant_key`, `tenant_display_name`, `organization`, `tenant_team_slug`, and `repo_admin_team_slug`.
- At least one currently authorized approver (active admin of the target org) is available and their login matches the designated approver field.

## Setup Verification

1. Confirm these implementation files exist and are committed:
   - `.github/ISSUE_TEMPLATE/create-tenant-repos.yml` — issue form with `organization`, `tenant_name`, `repository_name`, `designated_approver`, `dry_run`, `justification` fields
   - `.github/workflows/create-tenant-repos.yml` — main workflow with validation, approval, and execution steps
2. Confirm test targets exist:
   - `tests/contract/create-tenant-repos-*.test.js`
   - `tests/integration/create-tenant-repos-*.test.js`
   - `tests/fixtures/create-tenant-repos-*`
3. Confirm tenant-registry root exists in repository with stable records on main branch.

## Workflow Path

1. Requester opens a repository-creation issue using the **Create tenant repositories** form, filling in:
   - Target organization
   - **Tenant name** — exactly as it appears in `tenant_display_name` in the registry (e.g. `ContosoUK`). Required for disambiguation if the requester maintains multiple tenants.
   - Repository name (one repository per request)
   - Designated approver login
   - Dry-run flag (default `true` — set `false` to execute)
   - Business justification
2. Workflow parses and normalizes the request, resolves canonical tenant context from `tenant-registry/` on main, and emits audit artifact with `awaiting_approval`.
3. Designated approver posts the comment `approved` on the issue.
4. Approval gate confirms the approver is the designated active org admin and binds the approval to the current context marker.
5. Approved execution:
   - Revalidates boundary context immediately before mutation
   - Creates repository if it doesn't exist
   - Grants admin to `X_RepoAdmin` team (no direct individual admin)
   - Applies terminal state label (e.g. `issueops:create-tenant-repos:executed`) to the issue
6. Audit artifact is uploaded as a workflow artifact.

## Validated Scenario Runbook

### Scenario 1: Happy path — new repository

**Preconditions**: Requester is active maintainer of `X_Tenant` and active member of `X_RepoAdmin`. Repository does not exist. `dry_run` = `false`.

1. Open a new issue from the **Create tenant repositories** form.
2. Fill in all fields including the exact `Tenant name` (e.g. `ContosoUK`).
3. Set `Dry-run mode` to `false`.
4. Confirm workflow reaches `awaiting_approval` — the audit summary shows:
   - `Validation: passed`
   - `Tenant resolution: resolved`
   - `Tenant matches: 1`
   - `Planned creation action: create_repository`
   - `Planned permission action: grant_admin`
   - `Direct admin avoidance: enforced_team_only`
5. Post `approved` as a comment from the designated approver account.
6. Confirm execution summary shows:
   - `Request status: executed`
   - `Repository creation result: created`
   - `Repo-admin grant result: granted`
   - `Added: 2`
   - `Audit persistence result: persisted`
   - `Rollback status: not_needed`
7. Confirm the label `issueops:create-tenant-repos:executed` is applied to the issue.

### Scenario 2: Idempotent re-run — repository already exists with admin

**Preconditions**: Same as Scenario 1 but the repository already exists and `X_RepoAdmin` already holds admin.

1. Re-run the workflow (or re-open/edit the issue) for the same repository.
2. Confirm execution summary shows:
   - `Repository creation result: noop`
   - `Repo-admin grant result: noop`
   - `No-op: 2`
   - `Request status: executed`

### Scenario 3: No tenant match

**Preconditions**: `Tenant name` filled with a name not in the registry, or requester is not a maintainer of any matching tenant team.

1. Submit request with an unknown `Tenant name` (e.g. `Contoso` instead of `ContosoUK`).
2. Confirm validation fails with:
   - `Validation: failed`
   - `Tenant resolution: no_match`
   - `Tenant matches: 0`
   - Validation warning: `Available tenant names in this organization: ContosoUK, ContosoUS` (or similar)
3. Confirm no approval step runs.

### Scenario 4: Tenant disambiguation (requester in multiple tenants)

**Preconditions**: Requester is maintainer in both `ContosoUK_Tenant` and `ContosoUS_Tenant`.

1. Submit request without specifying `Tenant name`, or with an ambiguous name.
2. Confirm validation resolves correctly for the specified tenant name, or fails with `ambiguous` if name matches multiple records.
3. Submit a second request specifying the exact tenant name. Confirm resolution is `resolved`, `Tenant matches: 1`.

### Scenario 5: Unauthorized approver

1. Submit a valid request.
2. Post `approved` from an account that is **not** the designated approver or is not an active org admin.
3. Confirm:
   - `Approval: denied`
   - Approval note matches: _"does not authorize tenant repository creation mutation"_
   - Execution step does not run.

### Scenario 6: Stale context invalidation

1. Submit a valid request and approve it.
2. Edit the issue to change the repository name (which changes the context marker).
3. Confirm the workflow shows:
   - `Approval: invalidated`
   - Request reverts to `awaiting_approval`
4. Re-approve with the designated approver. Confirm execution runs successfully.

### Scenario 7: Dry-run validation

1. Submit request with `Dry-run mode: true`. The default is `true`, so this is the default behaviour.
2. Approve with the designated approver.
3. Confirm execution summary shows `Request status: executed` (or `no_mutation_planned: true`) but **no repository was created** and **no permission was granted**.
4. Check that `Planned creation action` and `Planned permission action` are shown in the audit but `Repository creation result` and `Repo-admin grant result` are `noop`.

### Scenario 8: Partial failure — repository created but admin grant fails

1. Submit approved non-dry-run request.
2. Simulate or observe a transient failure during the `addOrUpdateTeamRepositoryPermission` call.
3. Confirm:
   - `Repository creation result: created`
   - `Repo-admin grant result: failed`
   - `Request status: failed`
   - `Rollback status: manual_remediation_required`
   - Audit note signals manual remediation is needed.
4. Re-run the workflow. Confirm idempotent repository no-op and successful grant retry.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|-------------|-----------|
| `Tenant resolution: no_match` | `Tenant name` doesn't match `tenant_display_name` in registry, or requester is not a maintainer of the tenant team | Check registry file and team membership |
| `Approval: invalidated` | Issue was edited after approval (context marker changed) | Re-approve with the designated approver |
| `Approval: denied` with "does not authorize" | Comment came from queue owner or non-designated user | Ensure only the designated approver posts `approved` |
| `Boundary revalidation: mismatched` | Requester authorization changed between validation and execution | Requester must regain maintainer status; re-validate and re-approve |
| `Audit persistence result: failed` | Workflow artifact write failed | Execution outcome is still visible in step summary; re-run to retry persistence |
| Label not applied to issue | `gh label create` step may have failed silently, or `GITHUB_TOKEN` lacks issues:write | Check `Ensure terminal state labels exist` step log |