# Quickstart: Tenant Creation IssueOps Workflow

## Goal

Create a tenant bootstrap operation that safely reconciles tenant teams/hierarchy, requester maintainer bootstrap, and durable per-tenant registry persistence.

## Prerequisites

- GitHub Issues and issue forms enabled in this repository.
- `ISSUEOPS_GITHUB_TOKEN` configured with least-privilege permissions needed to:
  - read target organization/team/membership state
  - create teams
  - update team parent-child links
  - add/promote requester as team maintainer
  - write workflow comments/artifacts and perform durable registry persistence workflow path
- At least one active owner in target organization available to approve request.

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
