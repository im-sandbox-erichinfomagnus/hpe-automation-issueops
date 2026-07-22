# Quickstart: Enhance Tenant Topology Model

## Feature
022-enhance-tenant-topology

## Branch
regression-fixes-cross-issueops-20260605

## Objective
Implement the 014 create-tenant-model enhancement to persist topology-first canonical tenant records, update issue intake, preserve compatibility with legacy tenant records, and keep existing approval/security controls unchanged.

## Prerequisites

- Local repository is up to date.
- Node.js test environment available.
- Access to existing tenant-model workflow files and tests.

## Step 1: Update issue form intake

Files:
- .github/ISSUE_TEMPLATE/create-tenant-model.yml

Actions:
- Add dropdown field tenant_type with values application, platform, shared-services.
- Add governance dropdowns for code scanning, secret scanning, and dependabot enabled values (true/false).
- Add external mapping text fields: cmdb_id, cost_center, business_unit.
- Add environment dropdown with values prod/nonprod and default nonprod.
- Add primary_contact and secondary_contact text fields.

Verification:
- Issue form renders in correct order with required defaults.

## Step 2: Extend parser model

Files:
- src/workflow-support/parse-tenant-creation-request.js
- src/scripts/run-request-validation.js (env wiring if needed)

Actions:
- Parse and normalize new fields.
- Build canonical topology draft:
  - orgName from organization input
  - root/admin/repo-admin deterministic names
  - repositories.owned as []
  - runnerTopology.runnerGroups as []
  - accessModel enforcement/roles fixed values
  - accessModel organizationRoleSpecifications with deterministic tenant-scoped role names and permission intent
  - governance booleans normalized
- Preserve source provenance fields.
- Support dual-read fallback from PARSED_LEGACY_TENANT_RECORD_JSON during migration validation scenarios.

Verification:
- Parser tests cover all new fields and defaults.

## Step 3: Extend validation

Files:
- src/workflow-support/validate-tenant-creation-request.js

Actions:
- Validate tenantType and environment enums.
- Validate governance booleans.
- Validate contact email format when present.
- Validate deterministic team naming and topology parent-link rules.
- Validate target state conflicts and policy preconditions.

Verification:
- Validation fails closed with actionable findings for invalid inputs.

## Step 4: Reconciliation and execution compatibility

Files:
- src/workflow-support/reconcile-tenant-creation.js
- src/scripts/run-approved-execution.js

Actions:
- Keep idempotent creation/link behavior for root/admin/repo-admin topology.
- Reconcile and create missing organization roles from topology.accessModel.organizationRoleSpecifications when role APIs are available.
- Add dual-read handling for legacy records.
- Write canonical topology shape for successful writes.
- Keep request-status and rollback semantics deterministic.
- Emit compatibility mode, lifecycle-status equivalence, and registry migration status for operator review.

Verification:
- Reruns do not recreate already-satisfied topology.
- Mixed old/new records produce stable outcomes.
- Execution artifacts include per-role created/noop/failed outcomes for tenant organization roles.

## Step 5: Audit and summary updates

Files:
- src/workflow-support/build-audit-artifact.js
- src/scripts/emit-audit-summary.js

Actions:
- Include canonical topology, governance, externalMappings, metadata, and compatibility indicators.
- Keep correlation/provenance fields present in outputs.

Verification:
- Summary and artifact remain readable for operators during migration window.

## Step 6: Test implementation

Files:
- tests/contract/*
- tests/fixtures/*
- tests/integration/*

Required coverage:
- Schema shape and validation contract tests.
- Parser tests for new issue-form fields and defaults.
- Reconciliation/execution idempotency tests for topology creation.
- Migration compatibility tests for legacy records.
- Summary/artifact regression tests.

Suggested commands:
- node --test tests/contract/create-tenant-model-validation.test.js tests/contract/create-tenant-model-compatibility.test.js tests/contract/create-tenant-model-audit-summary.test.js
- node --test tests/integration/create-tenant-model-workflow.test.js

## Exit criteria

- Canonical topology-first tenant record is persisted for new/updated writes.
- Legacy records remain readable and are handled by compatibility layer.
- Approval and least-privilege model unchanged.
- All required tests pass with no regressions in existing tenant workflows.
