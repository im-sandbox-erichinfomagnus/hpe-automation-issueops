# Implementation Plan: Tenant GitHub-Hosted Runner Creation IssueOps Workflow

**Branch**: `021-create-tenant-hosted-runner` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/021-create-tenant-hosted-runner/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Create a tenant-scoped GitHub-hosted runner creation IssueOps workflow that accepts one runner request for one tenant in one target organization, resolves canonical tenant context from `tenant-registry/` per the `specs/014-create-tenant-model` contract, derives the tenant topology admin team (`<tenant-slug>-admin`) and requires the requester's active membership, derives the tenant-prefixed runner name (`TenantName_RunnerBaseName`), resolves the target runner group (explicit tenant-patterned group or organization default), and creates the hosted runner only when missing after designated active-org-owner approval, with idempotent no-op convergence, dry-run support, bounded retry, and auditable artifacts.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` invoking Node.js scripts under `src/scripts/` and shared modules under `src/workflow-support/`
**Primary Dependencies**: `issue-ops/parser@v5`, existing GitHub API helpers in `src/workflow-support/github-team-api.js`, new hosted-runner API helper `src/workflow-support/github-runner-api.js`, existing approval gate and audit modules, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged organization reads, team-membership reads, and hosted-runner administration (`manage_runners:org` classic scope or equivalent fine-grained organization hosted-runner permission); repository `github.token` for non-privileged workflow context operations
**Configuration Surface**: `.github/ISSUE_TEMPLATE/create-tenant-hosted-runner.yml` (new), `.github/workflows/create-tenant-hosted-runner.yml` (new), pre-provisioned `tenant-registry/` path invariant from 014, workflow env for operation metadata, approval signal, dry-run
**Testing**: `actionlint`, `node --test` contract tests for parser/validation/approval, integration tests for reconciliation/no-op/blocked/retry paths, fixtures under `tests/fixtures/`
**Target Platform**: GitHub-hosted runners
**Project Type**: IssueOps automation repository with reusable workflows and issue templates
**Observability**: GitHub step summaries + JSON audit artifacts with intake/approval/reconciliation/mutation outcomes and correlation IDs
**Constraints**: least privilege, explicit active-org-owner approval gate, fail-closed tenant CI/CD-admin requester authorization, idempotent reconciliation, bounded retry, dry-run no mutation, organization-level scope only, no topology admin team creation
**Scale/Scope**: one hosted runner per request, one tenant per request, one target organization per request

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
specs/021-create-tenant-hosted-runner/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── create-tenant-hosted-runner-workflow.yaml
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    create-tenant-hosted-runner.yml
  workflows/
    create-tenant-hosted-runner.yml

src/
  actions/
    hosted-runner-policy/
  workflow-support/
    github-runner-api.*
    resolve-tenant-cicd-context-from-registry.*
    parse-hosted-runner-request.*
    validate-hosted-runner-request.*
    reconcile-hosted-runner-creation.*
    resolve-hosted-runner-approver.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    create-tenant-hosted-runner-*.test.*
  fixtures/
    create-tenant-hosted-runner-*.md
    create-tenant-hosted-runner-*.json
  integration/
    create-tenant-hosted-runner-*.test.*
```

**Structure Decision**: Keep intake in `.github/ISSUE_TEMPLATE` and keep `.github/workflows/create-tenant-hosted-runner.yml` as a thin orchestration shim. Implement parser/validation/approval/reconciliation logic under `src/workflow-support/`, the hosted-runner policy guard in `src/actions/hosted-runner-policy/`, and extend the shared operation scripts under `src/scripts/`. The new `github-runner-api.js` module and `resolve-tenant-cicd-context-from-registry.js` resolver are shared with the sibling runner features (022 delete hosted runner, 023 create runner groups). Add contract and integration tests in `tests/` with fixtures. No structure exception is required.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
