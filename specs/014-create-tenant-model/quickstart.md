# Quickstart: Tenant Creation IssueOps Workflow

## Goal

Create a tenant bootstrap operation that safely reconciles tenant teams/hierarchy, requester maintainer bootstrap, and durable per-tenant registry persistence with automated git commit back to the source repository.

## Prerequisites

- GitHub Issues and issue forms enabled in this repository.
- `ISSUEOPS_GITHUB_TOKEN` configured with least-privilege permissions needed to:
  - read target organization/team/membership state
  - create teams
  - update team parent-child links
  - add/promote requester as team maintainer
- Workflow has `contents: write` permission (required for registry git commit).
- `tenant-registry/` directory pre-provisioned in the repository (contains `.gitkeep`).
- At least one active owner in target organization available to approve request.

## Phase 1 Setup Verification

1. Confirm feature docs exist:
  - `specs/014-create-tenant-model/spec.md`
  - `specs/014-create-tenant-model/plan.md`
  - `specs/014-create-tenant-model/research.md`
  - `specs/014-create-tenant-model/data-model.md`
  - `specs/014-create-tenant-model/contracts/create-tenant-model-workflow.yaml`
2. Confirm issue form and workflow entrypoint paths exist:
  - `.github/ISSUE_TEMPLATE/create-tenant-model.yml`
  - `.github/workflows/create-tenant-model.yml`
3. Confirm `tenant-registry/` directory exists in repository root with `.gitkeep`.
4. Confirm test files exist:
  - `tests/contract/create-tenant-model-*.test.*`
  - `tests/integration/create-tenant-model-*.test.*`
  - `tests/fixtures/create-tenant-model-*`

## Workflow Path

1. Requester opens tenant-creation issue with target organization, tenant name, dry-run flag, and justification.
2. Parser normalizes tenant name and derives:
  - `TenantName_Tenant`
  - `TenantName_RepoAdmins`
3. Validation confirms org visibility, naming/slug safety, hierarchy prerequisites, requester eligibility, designated approver eligibility, and registry path safety.
4. Approval gate waits for explicit `approved` comment from designated active target-org owner.
5. Execution reconciles state:
  - create missing teams only
  - link child team only if missing
  - requester maintainer bootstrap only if needed
6. Workflow persists per-tenant registry record under `tenant-registry/<tenant_key>.json` and commits it to the repository.
7. If durable write cannot complete, run reports blocked/partial-failure and emits fallback evidence for manual remediation.
8. Step summary + JSON artifact report all per-step outcomes including registry commit status.

## Manual Runtime Verification (Operator Runbook)

1. Submit valid request in non-dry-run mode.
2. Confirm validation run reports `awaiting_approval` with no mutation.
3. Post exact `approved` comment from designated active org owner.
4. Confirm execution run reports:
  - team create outcomes (`applied` or `noop`)
  - hierarchy link outcome (`applied` or `noop`)
  - requester maintainer bootstrap outcome (`applied` or `noop`)
  - registry persistence outcome (`created`/`updated`/`noop`)
  - registry commit status line in step summary: `✅ Registry Persistence: Tenant registry committed to repository`
5. Confirm `tenant-registry/<tenant_key>.json` appears in the repository on GitHub.com.
6. Re-run same approved request.
7. Confirm idempotent no-op outcomes: `mutation_count: 0`, `noop_count: 4`.
8. Confirm registry commit step shows `ℹ️ Registry Persistence: No registry changes to commit (file unchanged)`.
9. Confirm no new commit appears in `tenant-registry/` for the rerun.

## Validated Examples

### Example 1 — Fabrikam (initial implementation validation)

Validated on 2026-05-28 in `im-sandbox-himanshu/issueops-speckit`.

- Request ID: `im-sandbox-himanshu/issueops-speckit#207/26559705713.1`
- Tenant: `Fabrikam` (`fabrikam`)
- Dry-run mode: `false`
- Request status: `executed`
- Added: `4` | No-op: `0` | Failed: `0`
- Registry: `created`, committed to `tenant-registry/fabrikam.json`

### Example 2 — TestContoso (registry commit validation)

Validated on 2026-05-28 in `im-sandbox-himanshu/issueops-speckit` after `contents: write` permission fix.

- Request ID: `im-sandbox-himanshu/issueops-speckit#211`
- Tenant: `TestContoso` (`testcontoso`)
- Dry-run mode: `false`
- Request status: `executed`
- Registry: `created`, committed to `tenant-registry/testcontoso.json` and visible on GitHub.com

## Validation Scenarios

### Scenario 1: Happy-path bootstrap ✅ Validated

1. Submit valid request where both teams do not exist.
2. Approve with active org owner.
3. Confirm both teams created, hierarchy linked, requester maintainer assigned, registry record persisted and committed.
4. Verify `tenant-registry/<tenant_key>.json` visible on GitHub.com with all required fields.

### Scenario 2: No-op rerun

1. Re-run approved request with already converged state.
2. Confirm no duplicate team/hierarchy/bootstrap mutation (`mutation_count: 0`, `noop_count: 4`).
3. Confirm registry commit step shows `noop` — no new commit to `tenant-registry/`.

### Scenario 3: Re-parent blocked

1. Ensure derived repo-admin team exists under different parent.
2. Submit and validate request.
3. Confirm validation rejects with `reparent_blocked` finding — no approval gate opened, no mutation.

### Scenario 4: Unauthorized approver

1. Submit valid request.
2. Post approval comment from non-owner or non-designated actor.
3. Confirm approval denied: `approval_status: denied`, `approver_authorization_state: unauthorized`.
4. Confirm execution remains blocked, no teams created, no registry written.

### Scenario 5: Registry durable write failure

1. Temporarily rename `tenant-registry/` directory to simulate missing path.
2. Run approved request.
3. Confirm `request_status: partially_executed`, `registry_persistence_result.status: blocked_missing_directory`.
4. Confirm fallback artifact uploaded as workflow artifact.

### Scenario 6: Dry-run behavior

1. Submit request with `Dry run: Yes`.
2. Approve with active org owner.
3. Confirm `execution.mutation_count: 0`, `request.dry_run: true`.
4. Confirm no teams created in org, no registry file written or committed.

## Remediation: Registry Commit Failed

If a run shows `⚠️ Registry Persistence: Failed to commit registry record`:

1. Check the workflow run logs for `[registry-commit]` error lines.
2. Verify the workflow has `contents: write` in its permissions block.
3. Verify the runner can reach `github.com` (no proxy/firewall blocking).
4. The registry JSON was written to `tenant-registry/` on the runner but not committed — manually create the commit from the fallback artifact if needed.

## Exit Criteria

- Approval gate only accepts designated active target-org owner.
- Reconciliation is idempotent across reruns.
- Re-parenting remains blocked for conflicting current hierarchy.
- Requester maintainer bootstrap behaves correctly for add/promote/no-op states.
- Durable per-tenant registry persistence is visible in the repository and auditable; failure is not reported as full success.
- Registry commit result is reported in step summary and audit artifact.
- Summary and audit artifact provide sufficient operator evidence for every run.


## Phase 1 Setup Verification

1. Confirm feature docs exist:
  - `specs/014-create-tenant-model/spec.md`
  - `specs/014-create-tenant-model/plan.md`
  - `specs/014-create-tenant-model/research.md`
  - `specs/014-create-tenant-model/data-model.md`
  - `specs/014-create-tenant-model/contracts/create-tenant-model-workflow.yaml`
2. Confirm issue form and workflow entrypoint paths reserved for implementation:
  - `.github/ISSUE_TEMPLATE/create-tenant-model.yml`
  - `.github/workflows/create-tenant-model.yml`
3. Confirm test scaffolding targets are planned:
  - `tests/contract/create-tenant-model-*.test.*`
  - `tests/integration/create-tenant-model-*.test.*`
  - `tests/fixtures/create-tenant-model-*`

## Workflow Path

1. Requester opens tenant-creation issue with target organization, tenant name, dry-run flag, and justification.
2. Parser normalizes tenant name and derives:
  - `TenantName_Tenant`
  - `TenantName_RepoAdmins`
3. Validation confirms org visibility, naming/slug safety, hierarchy prerequisites, requester eligibility, designated approver eligibility, and registry path safety.
4. Approval gate waits for explicit `approved` comment from designated active target-org owner.
5. Execution reconciles state:
  - create missing teams only
  - link child team only if missing
  - requester maintainer bootstrap only if needed
6. Workflow persists per-tenant registry record under `tenant-registry/` via preferred durable write path.
7. If durable write cannot complete, run reports blocked/partial-failure and emits fallback evidence for manual remediation.
8. Summary + JSON artifact report all per-step outcomes.

## Manual Runtime Verification (Operator Runbook)

1. Submit valid request in non-dry-run mode.
2. Confirm validation run reports `awaiting_approval` with no mutation.
3. Post exact `approved` comment from designated active org owner.
4. Confirm execution run reports:
  - team create outcomes (`applied` or `noop`)
  - hierarchy link outcome (`applied` or `noop`)
  - requester maintainer bootstrap outcome (`applied` or `noop`)
  - registry persistence outcome (`created`/`updated`/`noop`)
5. Re-run same approved request.
6. Confirm idempotent no-op outcomes and unchanged desired state.

## Validated Example

Validated on 2026-05-28 with a fresh non-dry-run tenant request in `im-sandbox-himanshu/issueops-speckit`.

- Request ID: `im-sandbox-himanshu/issueops-speckit#207/26559705713.1`
- Target organization: `im-sandbox-himanshu`
- Tenant: `Fabrikam` (`fabrikam`)
- Tenant parent team: `fabrikam_tenant`
- Tenant repo-admin team: `fabrikam_repoadmins`
- Designated approver: `himanshu-im`
- Requester: `himanshu-im`
- Intake mode: `manual`
- Dry-run mode: `false`
- Request status: `executed`
- Central assignment: `assigned (aeruvakalpanaa)`
- Approval: `approved (authorized)`
- Validation: `passed`
- Teams to create: `2`
- Teams already present: `0`
- Child links to apply: `0`
- Requester bootstrap action: `ensure_maintainer`
- Registry persistence action: `write`
- Added: `4`
- No-op: `0`
- Pending: `0`
- Failed: `0`
- Rollback status: `not_needed`

Observed execution summary:

- `Approved tenant bootstrap execution completed. Processed 4 tenant_bootstrap(ies), 0 no-op tenant_bootstrap(ies), 0 rejected tenant_bootstrap(ies), 0 pending tenant_bootstrap(ies), and 0 failed tenant_bootstrap(ies).`
- `create-tenant-model` workflow is wired for validation, approval, and approved execution routing.

The no-op rerun and failure-remediation scenarios below still need explicit operator validation.

## Validation Scenarios

### Scenario 1: Happy-path bootstrap

1. Submit valid request where both teams do not exist.
2. Approve with active org owner.
3. Confirm both teams created, hierarchy linked, requester maintainer assigned, registry record persisted.

### Scenario 2: No-op rerun

1. Re-run approved request with already converged state.
2. Confirm no duplicate team/hierarchy/bootstrap mutation.

### Scenario 3: Re-parent blocked

1. Ensure derived repo-admin team exists under different parent.
2. Submit and validate request.
3. Confirm request rejected with explicit re-parent remediation guidance.

### Scenario 4: Unauthorized approver

1. Submit valid request.
2. Post approval from non-owner or non-designated actor.
3. Confirm approval denied and execution remains blocked.

### Scenario 5: Registry durable write failure

1. Simulate durable write path failure.
2. Confirm run reports partial/blocking result and fallback artifact guidance.

### Scenario 6: Dry-run behavior

1. Submit dry-run request.
2. Confirm reconciliation plan is emitted with no org mutation and no successful durable write claim.

## Exit Criteria

- Approval gate only accepts designated active target-org owner.
- Reconciliation is idempotent across reruns.
- Re-parenting remains blocked for conflicting current hierarchy.
- Requester maintainer bootstrap behaves correctly for add/promote/no-op states.
- Durable per-tenant registry persistence is visible and auditable; failure is not reported as full success.
- Summary and audit artifact provide sufficient operator evidence for every run.
