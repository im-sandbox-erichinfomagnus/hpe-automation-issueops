# Implementation Plan: Tenant CI/CD Admin Bootstrap

**Branch**: `024-create-feature-branch` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-tenant-cicd-admin/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the tenant bootstrap workflow from spec 014 by adding deterministic third-team support (`<TenantName>_Tenant_CICDAdmin`) and CI/CD admin capability intent handling with strict least-privilege constraints. Preserve baseline approval-gated, reconciliation-first, idempotent behavior; persist CICDAdmin topology parent-child relationship under `topology.teams.structure` with explicit apply/noop/blocked outcomes; and extend audit/registry outputs with capability status taxonomy (`requested`, `applied`, `skipped`, `blocked`, `unavailable`, `failed`) plus reason-code evidence.

## Technical Context

**Workflow Runtime**: GitHub Actions workflow shim on `ubuntu-latest` invoking Node.js scripts under `src/scripts` and shared modules under `src/workflow-support`  
**Primary Dependencies**: `issue-ops/parser@v5`, existing GitHub API helpers in `src/workflow-support`, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged target-org reads/mutations and capability checks; workflow `github.token` for repo-local operations  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/create-tenant-model.yml`, `.github/workflows/create-tenant-model.yml`, tenant registry records under `tenant-registry/`  
**Testing**: `node --test` contract/integration suites for parser, validation, approval, reconciliation, capability-path selection, execution, and audit summary behavior  
**Target Platform**: GitHub-hosted runners  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: Structured step summaries and JSON audit artifacts including capability selected path, capability status/reason, and registry extension persistence result  
**Constraints**: Least privilege, explicit approval gate, fail-closed validation/revalidation, bounded retry/rate-limit behavior, idempotent reruns, no unauthorized broad org-wide CI/CD privilege expansion  
**Scale/Scope**: Existing create-tenant-model workflow enhancement only; one tenant per request; one target organization per request; third team plus capability intent extension

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

Initial gate result: PASS  
Post-design gate result: PASS

## Project Structure

Use the constitution section `Repository Structure Conventions` to keep the feature layout and repository paths aligned with the repository-standard structure.

### Documentation (this feature)

```text
specs/024-tenant-cicd-admin/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── create-tenant-cicd-admin-workflow.yaml
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
  actions/
    team-creation-policy/
    team-hierarchy-policy/
    team-membership-policy/
  workflow-support/
    parse-tenant-creation-request.*
    validate-tenant-creation-request.*
    resolve-tenant-creation-approver.*
    reconcile-tenant-creation.*
    persist-tenant-registry-record.*
    build-audit-artifact.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
  fixtures/
  integration/
```

**Structure Decision**: Keep `.github/workflows/create-tenant-model.yml` as a thin orchestration shim and implement business logic changes in `src/workflow-support` and `src/scripts`. Extend existing parser/validator/reconciliation modules to support CICDAdmin team derivation, hierarchy checks, topology consistency checks, capability path evaluation (primary/fallback/blocked), and registry/audit extension fields including `topology.teams.structure` apply/noop/blocked persistence outcomes. Preserve reuse of existing policy guards in `src/actions` and add contract/integration coverage in existing `tests/contract` and `tests/integration` suites. No structure exception is required.

## Complexity Tracking

No constitution violations were identified for this feature design.
