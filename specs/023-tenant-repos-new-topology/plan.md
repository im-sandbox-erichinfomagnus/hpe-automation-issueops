# Implementation Plan: Tenant Repos on New Topology

**Branch**: `023-tenant-repos-new-topology` | **Date**: 2026-06-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-tenant-repos-new-topology/spec.md`

Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the existing create-tenant-repos IssueOps workflow to read canonical tenant topology from spec 022, preserve legacy fallback behavior, and persist repository ownership metadata by appending one object per successful request into `topology.repositories.owned`. Add deterministic defaulting for non-visibility metadata fields, enforce duplicate repository-name validation from owned topology context, and keep approval-gated, reconciliation-first, idempotent execution semantics.

## Technical Context

**Workflow Runtime**: GitHub Actions workflow shim on `ubuntu-latest` invoking Node.js scripts under `src/scripts` and shared modules under `src/workflow-support`  
**Primary Dependencies**: `issue-ops/parser@v5`, existing GitHub API helpers in `src/workflow-support`, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged org/team/repository reads and mutations; workflow `github.token` for non-privileged repo-local operations  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/create-tenant-repos.yml`, `.github/workflows/create-tenant-repos.yml`, tenant registry records under `tenant-registry/`  
**Testing**: `node --test` contract/integration suites for parser, validation, approval, reconciliation, execution, and audit summary behavior  
**Target Platform**: GitHub-hosted runners
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: Structured step summaries and JSON audit artifacts including topology mode, duplicate-check result, owned-entry append/no-op result, and defaults-applied fields  
**Constraints**: Least privilege, explicit approval gate, fail-closed validation/revalidation, bounded retry/rate-limit behavior, idempotent reruns, no replacement of GitHub as source of truth  
**Scale/Scope**: Existing create-tenant-repos workflow enhancement only; one repository per request; multi-repository per tenant supported through append-only `topology.repositories.owned`

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
specs/023-tenant-repos-new-topology/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── create-tenant-repos-topology-workflow.yaml
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
    resolve-tenant-context-from-registry.*
    validate-tenant-repo-request.*
    reconcile-tenant-repo-creation.*
    build-audit-artifact.*
    build-execution-outcome.*
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

**Structure Decision**: Keep `.github/workflows/create-tenant-repos.yml` as a thin orchestration shim and implement all business logic changes in `src/workflow-support` and `src/scripts`. Extend existing parser/validator/reconciliation modules to support canonical topology reads, legacy fallback, duplicate owned-repo validation, and owned-entry append persistence. Preserve policy guard reuse in `src/actions` and add coverage in existing `tests/contract` and `tests/integration` suites. No structure exception is required.

## Complexity Tracking

No constitution violations were identified for this feature design.
