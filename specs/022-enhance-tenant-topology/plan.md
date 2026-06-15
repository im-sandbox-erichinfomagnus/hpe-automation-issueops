# Implementation Plan: Enhance Tenant Topology Model

**Branch**: `regression-fixes-cross-issueops-20260605` | **Date**: 2026-06-09 | **Spec**: `specs/022-enhance-tenant-topology/spec.md`
**Input**: Feature specification from `specs/022-enhance-tenant-topology/spec.md`

Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Evolve the tenant creation workflow from the current flat tenant registry shape into a topology-first canonical model containing tenant identity, team hierarchy, governance controls, external mappings, and metadata. The plan keeps the existing IssueOps approval and least-privilege model intact while introducing form fields, parser/validator enhancements, deterministic topology derivation, and a dual-read plus canonical-write compatibility strategy for existing legacy records.

## Technical Context

**Workflow Runtime**: GitHub Actions reusable workflows on `ubuntu-latest`.  
**Primary Dependencies**: `issue-ops/parser@v5`, existing workflow-support modules under `src/workflow-support`, GitHub REST APIs via current action wrappers, Node.js runtime.  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged mutations plus least-privilege `GITHUB_TOKEN` for workflow-local operations.  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/create-tenant-model.yml`, tenant validation/reconciliation modules under `src/workflow-support`, workflow shims under `.github/workflows`.  
**Testing**: `node --test` suites across `tests/contract`, `tests/fixtures`, and `tests/integration`; include compatibility fixtures for legacy tenant records.  
**Target Platform**: GitHub-hosted runners.
**Project Type**: IssueOps automation repository with reusable workflows and issue templates.  
**Observability**: Structured step summaries and JSON audit artifacts with deterministic fields and request-status transitions.  
**Constraints**: Reconciliation-first idempotency, explicit approval gate, fail-closed mutation behavior, bounded retry/rate-limit controls, no replacement of GitHub as system of record.  
**Scale/Scope**: Feature 014 enhancement for tenant model creation/update path only; excludes tenant repository population and runner-group provisioning.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Authorization requirements are defined for every privileged action, including requester,
  approver, and executing identity boundaries.
- [x] Validation strategy covers issue form parsing, schema/input checks, actor eligibility,
  and target-state preconditions.
- [x] Reconciliation logic defines current-state reads, drift detection, idempotent no-op
  behavior, and safe re-run semantics.
- [x] Dry-run behavior, rollback or compensating actions, and partial failure handling are
  specified before implementation.
- [x] Structured logging and audit artifacts identify the issue, actor, approvers, API
  operations, reconciliation outcome, and final state.
- [x] GitHub API rate-limit and retry strategy is defined, including handling for secondary
  rate limits or abuse protection.
- [x] Reusable workflow boundaries and shared policy components are identified; one-off logic
  is justified in Complexity Tracking if retained.

## Project Structure

Use the constitution section `Repository Structure Conventions` to keep the feature layout and repository paths aligned with the repository-standard structure.

### Documentation (this feature)

```text
specs/022-enhance-tenant-topology/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── tenant-topology-workflow.yaml
└── tasks.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    create-tenant-model.yml
  workflows/
    create-tenant-model.yml

src/
  workflow-support/
    parse-tenant-model-request.js
    validate-tenant-model-request.js
    reconcile-tenant-creation.js
    build-audit-artifact.js
  scripts/
    run-request-validation.js
    run-approved-execution.js
    emit-audit-summary.js

tests/
  contract/
  fixtures/
  integration/
```

**Structure Decision**: Keep workflow YAML as orchestration shims and implement all substantive behavior in existing `src/workflow-support` and `src/scripts` modules. Add no new top-level directories. Extend existing create-tenant-model issue template and workflow contracts while preserving current reusable policy boundaries.

## Post-Design Constitution Check

- [x] Design artifacts include explicit authorization, validation, reconciliation, rollback, observability, and rate-limit behavior.
- [x] Compatibility strategy for legacy tenant records is defined with dual-read and canonical-write behavior.
- [x] Re-run idempotency and no-op behavior are explicitly documented for topology creation and migration scenarios.
- [x] Proposed changes remain within existing repository structure conventions.

## Complexity Tracking

No constitution violations were identified for this feature design.
