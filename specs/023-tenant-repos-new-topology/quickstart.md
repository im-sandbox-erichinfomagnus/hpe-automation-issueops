# Quickstart: Tenant Repos on New Topology

## Feature
023-tenant-repos-new-topology

## Objective
Enhance create-tenant-repos to consume canonical tenant topology (spec 022), persist repository ownership entries in `topology.repositories.owned`, enforce duplicate-name validation from topology context, and keep legacy compatibility.

## Prerequisites

- Local repository is current.
- Node.js test environment available.
- Existing create-tenant-repos workflow and tests are green.

## Step 1: Extend request parsing and normalization

Files:
- src/workflow-support/parse-tenant-repo-request.js
- src/scripts/run-request-validation.js

Actions:
- Ensure visibility is parsed as required issue-form field and stored explicitly.
- Normalize repository name for duplicate checks and idempotency.
- Carry metadata fields needed for owned-entry construction.

Verification:
- Parser contract tests confirm visibility presence and normalized repo name output.

## Step 2: Add canonical topology + legacy fallback reads

Files:
- src/workflow-support/resolve-tenant-context-from-registry.js
- src/workflow-support/validate-tenant-repo-request.js

Actions:
- Prefer canonical topology paths from spec 022.
- Fallback to legacy projection when canonical fields are absent.
- Resolve tenant root and repo-admin teams from topology.

Verification:
- Validation tests pass for canonical and legacy fixtures.

## Step 3: Add owned-repository duplicate validation

Files:
- src/workflow-support/validate-tenant-repo-request.js

Actions:
- Read `topology.repositories.owned` as authoritative per-tenant list.
- Fail validation when normalized requested repo name already exists.
- Emit clear duplicate-name error referencing topology owned list.

Verification:
- Contract tests cover case-insensitive and normalized duplicates.

## Step 4: Persist owned repository entry on successful execution

Files:
- src/workflow-support/reconcile-tenant-repo-creation.js
- src/scripts/run-approved-execution.js
- src/workflow-support/build-audit-artifact.js

Actions:
- Append one `RepositoryOwnership` object per successful creation.
- Initialize `topology.repositories.owned` to [] when absent.
- Use defaults for non-visibility missing fields:
  - repoType=service
  - lifecycle=active
  - migrationWave=wave-1
  - source=ghec
- Keep visibility from issue form only (no default).

Verification:
- Integration tests confirm append behavior and no duplicate append on rerun.

## Step 5: Idempotency and concurrency safety

Files:
- src/workflow-support/reconcile-tenant-repo-creation.js
- src/workflow-support/build-execution-outcome.js

Actions:
- Treat existing matching owned entry as no-op on rerun.
- Fail closed if concurrent mutation introduces duplicate before persistence.

Verification:
- Integration tests cover rerun no-op and concurrent duplicate blocked paths.

## Step 6: Update contracts and tests

Files:
- specs/023-tenant-repos-new-topology/contracts/create-tenant-repos-topology-workflow.yaml
- tests/contract/*tenant-repos*
- tests/integration/*tenant-repos*
- tests/fixtures/*tenant-repos*

Required coverage:
- Canonical topology read path.
- Legacy fallback path.
- Duplicate-name validation in owned list.
- Owned-entry append and defaulting behavior.
- Visibility non-default enforcement.
- Rerun idempotency for owned-list persistence.

## Suggested Commands

- node --test tests/contract/create-tenant-repos-validation.test.js
- node --test tests/contract/create-tenant-repos-parser-fixture.test.js
- node --test tests/integration/create-tenant-repos-request.test.js
- node --test tests/integration/create-tenant-repos-workflow.test.js

## Exit Criteria

- Workflow validates tenant context using canonical topology when available.
- Duplicate repository names in `topology.repositories.owned` are blocked with clear errors.
- Successful creation appends one complete owned entry with required fields.
- Visibility is sourced from issue form and never defaulted.
- Reruns are idempotent and do not append duplicate owned entries.
