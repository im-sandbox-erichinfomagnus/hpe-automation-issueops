# Implementation Plan: Tenant GitHub-Hosted Runner Deletion IssueOps Workflow

**Branch**: `022-delete-tenant-hosted-runner` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/022-delete-tenant-hosted-runner/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Create a tenant-scoped GitHub-hosted runner deletion IssueOps workflow that accepts one deletion request for one tenant in one target organization, resolves canonical tenant context and the derived `<tenant-slug>-admin` authorization team via the shared resolver from feature 021, derives the tenant-prefixed runner name, resolves the existing runner identifier from live organization state, and deletes the runner only when present after designated active-org-owner approval, treating an absent runner as converged no-op, with dry-run support, bounded retry, boundary revalidation, and auditable artifacts.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` invoking Node.js scripts under `src/scripts/` and shared modules under `src/workflow-support/`
**Primary Dependencies**: `issue-ops/parser@v5`, shared hosted-runner API helper `src/workflow-support/github-runner-api.js` (from 021), shared tenant CI/CD resolver `src/workflow-support/resolve-tenant-cicd-context-from-registry.js` (from 021), existing approval gate and audit modules, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged organization reads, team-membership reads, and hosted-runner administration; repository `github.token` for non-privileged workflow context operations
**Configuration Surface**: `.github/ISSUE_TEMPLATE/delete-tenant-hosted-runner.yml` (new), `.github/workflows/delete-tenant-hosted-runner.yml` (new), pre-provisioned `tenant-registry/` path invariant from 014
**Testing**: `actionlint`, `node --test` contract tests for parser/validation, integration tests for deletion/no-op/blocked paths, fixtures under `tests/fixtures/`
**Target Platform**: GitHub-hosted runners
**Project Type**: IssueOps automation repository with reusable workflows and issue templates
**Observability**: GitHub step summaries + JSON audit artifacts with intake/approval/reconciliation/mutation outcomes and correlation IDs
**Constraints**: least privilege, explicit active-org-owner approval gate, fail-closed tenant CI/CD-admin requester authorization, idempotent no-op for absent runners, bounded retry, dry-run no mutation, organization-level scope only
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
specs/022-delete-tenant-hosted-runner/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── delete-tenant-hosted-runner-workflow.yaml
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    delete-tenant-hosted-runner.yml
  workflows/
    delete-tenant-hosted-runner.yml

src/
  actions/
    hosted-runner-policy/        # shared with 021
  workflow-support/
    github-runner-api.*          # shared with 021
    resolve-tenant-cicd-context-from-registry.*  # shared with 021
    parse-hosted-runner-deletion-request.*
    validate-hosted-runner-deletion-request.*
    reconcile-hosted-runner-deletion.*
    resolve-hosted-runner-approver.*  # shared with 021
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    delete-tenant-hosted-runner-*.test.*
  fixtures/
    delete-tenant-hosted-runner-*.md
  integration/
    delete-tenant-hosted-runner-*.test.*
```

**Structure Decision**: Reuse the 021 foundations (`github-runner-api.js`, `resolve-tenant-cicd-context-from-registry.js`, `hosted-runner-policy`, `resolve-hosted-runner-approver.js`) and add deletion-specific parse/validate/reconcile modules. The workflow shim and issue form follow the standard thin-entrypoint pattern. No structure exception is required.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
