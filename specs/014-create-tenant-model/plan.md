# Implementation Plan: Tenant Creation IssueOps Workflow

**Branch**: `014-tenant-creation-model` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-create-tenant-model/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Create a new tenant-creation IssueOps workflow that accepts one tenant bootstrap request for one target organization, reconciles the desired tenant structure by creating only missing teams (`TenantName_Tenant`, `TenantName_RepoAdmins`), links `TenantName_RepoAdmins` beneath `TenantName_Tenant`, ensures requester maintainer bootstrap on the tenant parent team, and persists a durable per-tenant registry file in `tenant-registry/` in this repository, where `tenant-registry/` is a pre-provisioned repository invariant and missing-path conditions fail fast with blocked or partial-failure semantics.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` invoking Node.js scripts under `src/scripts/` and shared modules under `src/workflow-support/`  
**Primary Dependencies**: `issue-ops/parser@v5`, existing GitHub API helpers in `src/workflow-support/github-team-api.js`, existing approval gate and audit modules, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged organization/team mutation and org-owner membership reads; repository `github.token` for non-privileged workflow context operations  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/create-tenant-model.yml` (new), `.github/workflows/create-tenant-model.yml` (new), pre-provisioned `tenant-registry/` path invariant, workflow env for operation metadata, approval signal, dry-run, and registry persistence mode  
**Testing**: `actionlint`, `node --test` contract tests for parser/validation/approval, integration tests for reconciliation/no-op/partial-failure/retry paths, fixtures under `tests/fixtures/`  
**Target Platform**: GitHub-hosted runners  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries + JSON audit artifacts with intake/approval/reconciliation/mutation/registry persistence outcomes and correlation IDs  
**Constraints**: least privilege, explicit active-org-owner approval gate, fail-closed authorization, idempotent reconciliation, bounded retry, dry-run no mutation, pre-provisioned tenant-registry path invariant, no tenant-boundary changes to existing operations in this feature  
**Scale/Scope**: one tenant per request, one target organization per request, tenant bootstrap teams/hierarchy/requester maintainer assignment, durable per-tenant registry file persistence

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
specs/014-create-tenant-model/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── create-tenant-model-workflow.yaml
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
    create-tenant-model-*.test.*
  fixtures/
    create-tenant-model-*.json
    create-tenant-model-*.md
  integration/
    create-tenant-model-*.test.*
```

**Structure Decision**: Keep intake in `.github/ISSUE_TEMPLATE` and keep `.github/workflows/create-tenant-model.yml` as a thin orchestration shim. Implement parser/validation/approval/reconciliation/registry-persistence logic under `src/workflow-support/`, policy guards in `src/actions/`, and operation scripts under `src/scripts/`. Add contract and integration tests in `tests/` with fixtures. No structure exception is required.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
