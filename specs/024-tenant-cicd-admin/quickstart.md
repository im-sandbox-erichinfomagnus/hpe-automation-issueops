# Quickstart: Tenant CI/CD Admin Bootstrap

## Goal

Extend tenant bootstrap to include a third team (`<TenantName>_Tenant_CICDAdmin`) and safe CI/CD admin capability intent handling while preserving all baseline behavior from spec 014.

## Prerequisites

- GitHub Issues and issue forms enabled in this repository.
- `ISSUEOPS_GITHUB_TOKEN` configured with least-privilege permissions for:
  - organization/team state reads
  - team creation and hierarchy linkage
  - requester maintainer bootstrap operations
  - policy-approved CI/CD capability checks/assignment where supported
- Workflow has required repository permissions for audit and registry persistence.
- `tenant-registry/` directory pre-provisioned in repository root.
- Designated active owner in target organization available for approval.

## Phase 0 and Phase 1 Artifact Verification

1. Confirm feature docs exist:
  - `specs/024-tenant-cicd-admin/spec.md`
  - `specs/024-tenant-cicd-admin/plan.md`
  - `specs/024-tenant-cicd-admin/research.md`
  - `specs/024-tenant-cicd-admin/data-model.md`
  - `specs/024-tenant-cicd-admin/contracts/create-tenant-cicd-admin-workflow.yaml`
2. Confirm baseline workflow extension targets are identified:
  - `.github/ISSUE_TEMPLATE/create-tenant-model.yml`
  - `.github/workflows/create-tenant-model.yml`
  - `src/workflow-support/*tenant*`
  - `src/scripts/run-request-validation.*`
  - `src/scripts/run-approved-execution.*`
3. Confirm test targets are identified:
  - `tests/contract/create-tenant-model-parser.test.js`
  - `tests/contract/create-tenant-model-validation.test.js`
  - `tests/contract/create-tenant-model-audit-summary.test.js`
  - `tests/contract/create-tenant-model-registry-commit.test.js`
  - `tests/contract/create-tenant-model-compatibility.test.js`
  - `tests/integration/create-tenant-model-workflow.test.js`
  - `tests/integration/create-tenant-model-request.test.js`
  - `tests/fixtures/create-tenant-model-cicd/capability-available.json`
  - `tests/fixtures/create-tenant-model-cicd/capability-unavailable.json`
  - `tests/fixtures/create-tenant-model-cicd/hierarchy-conflict.json`
  - `tests/fixtures/create-tenant-model-cicd/dry-run.json`

## Phase 1 Verification Commands

```powershell
node --test tests/contract/create-tenant-model-parser.test.js tests/contract/create-tenant-model-validation.test.js
node --test tests/integration/create-tenant-model-workflow.test.js tests/integration/create-tenant-model-request.test.js
```

## Final Comprehensive Test Suite (All Phases)

After all phases complete, run the full validation suite:

```powershell
# All contract and integration tests for CICD enhancement
node --test tests/contract/create-tenant-model-validation.test.js `
  tests/contract/create-tenant-model-audit-summary.test.js `
  tests/contract/create-tenant-model-compatibility.test.js `
  tests/contract/create-tenant-model-registry-commit.test.js `
  tests/integration/create-tenant-model-workflow.test.js
```

**Expected Result**: 64+ tests passing, 0 failures, ~1580ms duration

**Sample Output**:
```
# tests 64
# suites 0
# pass 64
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1581.6844
```

## Workflow Path

1. Requester submits tenant bootstrap request with baseline fields.
2. Parser derives baseline teams and new CICDAdmin team:
  - `<TenantName>_Tenant`
  - `<TenantName>_RepoAdmins`
  - `<TenantName>_Tenant_CICDAdmin`
3. Validation performs:
  - baseline spec 014 checks
  - deterministic CICDAdmin derivation and hierarchy checks
  - CI/CD capability prerequisite and safety-policy checks
4. Approval gate requires explicit approval from designated active target-org owner.
5. Execution reconciles current state:
  - creates missing teams only
  - applies required hierarchy links only when missing
  - preserves requester maintainer bootstrap behavior from spec 014
  - applies CI/CD capability only through approved safe path
6. If no safe tenant-scoped capability path exists, capability is blocked/unavailable with reason codes and remediation guidance.
7. Registry persistence records CICDAdmin team fields and capability status taxonomy.
8. Step summary and JSON audit artifact emit per-step outcomes and final status.

## Manual Runtime Verification (Operator Runbook)

1. Submit valid non-dry-run request.
2. Confirm validation run reaches `awaiting_approval` and does not mutate state.
3. Post `approved` from designated active target-org owner.
4. Confirm execution reports:
  - team create outcomes for all three derived teams
  - hierarchy outcomes for baseline and CICDAdmin links
  - requester bootstrap outcome
  - capability decision path (`primary`, `fallback`, `none`) and outcome (`applied`, `blocked`, `unavailable`, `failed`, or `skipped`)
  - registry persistence result with CICD extension fields
5. Re-run approved request.
6. Confirm idempotent no-op behavior (no duplicate creates/assignments).

## Validation Scenarios

### Scenario 1: Happy-path with capability available

1. Submit valid request where all three teams are missing.
2. Approve request.
3. Confirm all teams created, hierarchy converged, capability applied through approved path, and registry updated.

### Scenario 2: Capability unavailable with safe outcome

1. Submit valid request in org without approved primary capability path.
2. Approve request.
3. Confirm no unsafe org-wide privilege grant is performed.
4. Confirm capability outcome is `blocked` or `unavailable` with reason code and remediation.

### Scenario 3: Hierarchy conflict

1. Ensure CICDAdmin team exists under unexpected parent.
2. Submit and validate request.
3. Confirm conflict is blocked with clear remediation and no unsafe mutation.

### Scenario 4: Dry-run

1. Submit request with dry-run enabled.
2. Approve request.
3. Confirm no mutations; planned outcomes and capability decision are fully emitted.

### Scenario 5: Partial-failure semantics

1. Simulate successful team creation with later capability assignment failure.
2. Confirm final outcome is partial/blocking completion with remediation guidance.

### Scenario 6: Unauthorized approver

1. Submit valid request.
2. Post approval from non-designated or non-owner actor.
3. Confirm execution remains blocked.

## Exit Criteria

- Baseline behavior from spec 014 is preserved with no regression.
- CICDAdmin team derivation and reconciliation are deterministic and idempotent.
- No unauthorized broad org-wide privilege expansion occurs.
- Capability outcomes are auditable with reason codes and evidence.
- Partial-failure and blocked outcomes include actionable remediation guidance.
