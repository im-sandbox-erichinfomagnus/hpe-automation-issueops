# Implementation Plan: Tenant Repository Creation IssueOps Workflow

**Branch**: `019-create-tenant-repos` | **Date**: 2026-05-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-create-tenant-repos/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Create a new tenant-scoped repository-creation IssueOps workflow that accepts one repository request per issue, resolves one canonical tenant context from requester identity plus authoritative `tenant-registry/` data on the main branch, enforces `X_Tenant`/`X_RepoAdmin` governance prerequisites and context-bound approval, creates the repository only when execution-time revalidation still passes, grants admin permission to `X_RepoAdmin`, avoids direct individual admin by default, and persists durable audit and execution outcome evidence with explicit blocked, no-op, failed, and partial-failure semantics.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` invoking Node.js scripts under `src/scripts/` and shared modules under `src/workflow-support/`  
**Primary Dependencies**: `issue-ops/parser@v5`, existing GitHub API helpers and approval/audit modules under `src/workflow-support/`, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for boundary-critical organization/team/membership/repository reads and privileged repository/team-permission mutation; repository `github.token` for non-privileged workflow context operations  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/create-tenant-repos.yml`, `.github/workflows/create-tenant-repos.yml`, workflow env for operation metadata, dry-run intent, approval signal, and tenant-registry read mode, plus authoritative `tenant-registry/` data on the repository main branch  
**Testing**: `actionlint`, `node --test` contract/parser tests, integration tests for validation/approval/execution/no-op/partial-failure paths, fixtures under `tests/fixtures/`  
**Target Platform**: GitHub-hosted runners  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries plus retained machine-readable audit artifacts uploaded under repository workflow artifact retention policy, capturing tenant resolution, approval binding, reconciliation decisions, permission grant outcomes, and final lifecycle state  
**Constraints**: least privilege, explicit approver authorization, fail-closed tenant enforcement, approval bound to latest validated context, execution-time revalidation, authoritative tenant-registry lookup from main branch, no direct individual admin by default, bounded retry, dry-run no mutation  
**Scale/Scope**: one repository per request, one target organization per request, one canonical tenant context per request, tenant-scoped repository creation plus `X_RepoAdmin` admin grant and durable audit persistence

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
specs/019-create-tenant-repos/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── create-tenant-repos-workflow.yaml
└── tasks.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    create-tenant-repos.yml
  workflows/
    create-tenant-repos.yml

src/
  actions/
    repo-creation-policy/
    repo-permission-policy/
  workflow-support/
    parse-tenant-repo-request.*
    validate-tenant-repo-request.*
    resolve-tenant-context-from-registry.*
    resolve-tenant-repo-approver.*
    reconcile-tenant-repo-creation.*
    build-tenant-repo-audit-artifact.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    create-tenant-repos-*.test.*
  fixtures/
    create-tenant-repos-*
  integration/
    create-tenant-repos-*.test.*
```

**Structure Decision**: Keep issue intake in `.github/ISSUE_TEMPLATE` and the GitHub-required entrypoint in `.github/workflows/create-tenant-repos.yml` as a thin orchestration shim. Place tenant-resolution, authorization, reconciliation, and audit logic under `src/workflow-support/`, with any shared policy guards under `src/actions/` and runner scripts under `src/scripts/`. Add parser/contract tests under `tests/contract/`, mocked payloads and registry fixtures under `tests/fixtures/`, and end-to-end workflow behavior coverage under `tests/integration/`. No exception to the constitution structure rules is required.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
