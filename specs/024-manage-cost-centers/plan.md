# Implementation Plan: Manage Cost Centers IssueOps Workflow

**Branch**: `cost-center-management` | **Date**: 2026-06-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-manage-cost-centers/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Create a standalone cost-center-management IssueOps workflow that accepts one CSV spreadsheet of cost-center changes per issue, parses every row into create, rename, or delete intent, resolves each target against the enterprise's live cost centers when access is available, classifies and rejects rows fail-soft with row-cited reasons, gates mutation behind a designated-approver `approved` comment plus an enterprise-billing-scoped classic PAT, executes creates then renames then deletes idempotently with bounded retry after a live re-validation, and persists durable audit evidence with executed, partially_executed, and failed semantics plus a terminal label. The workflow owns cost-center entities only and is a sibling to the separate cost-center allocation operation.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` invoking Node.js scripts under `src/scripts/` and shared modules under `src/workflow-support/`  
**Primary Dependencies**: `issue-ops/parser@v5`, the dependency-free cost-center REST client under `src/workflow-support/github-cost-center-api.js`, existing approval, token-loading, and rate-limit helpers under `src/workflow-support/`, `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN`, a classic PAT with `manage_billing:enterprise` held by an enterprise owner or billing manager, for all cost-center reads and mutations; repository `github.token` for issue context, comment reads, and terminal-label application  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/manage-cost-centers.yml`, `.github/workflows/manage-cost-centers.yml`, workflow env for issue context, dry-run intent, and audit retention; optional `COST_CENTER_API_VERSION` override  
**Testing**: `node --test` contract and parser tests plus an integration test covering the full validate, approve, execute flow, denied approver, dry-run no-mutation, fail-soft, and the policy guard  
**Target Platform**: GitHub-hosted runners  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries plus a retained machine-readable audit artifact uploaded under repository workflow artifact retention policy, capturing request, validation, approval, reconciliation, and execution evidence  
**Constraints**: least privilege, designated-approver gate, PAT-backed enterprise billing token as the hard mutation control, fail-soft dry-run when no live access, deterministic create-rename-delete order, idempotent re-runs, bounded retry, dry-run no mutation  
**Scale/Scope**: one spreadsheet per request, one enterprise per request, bulk create, rename, and delete of cost-center entities only, no allocation or budget management

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
specs/024-manage-cost-centers/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── manage-cost-centers-workflow.yaml
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    manage-cost-centers.yml
  workflows/
    manage-cost-centers.yml

src/
  actions/
    cost-center-policy/
      index.js
  workflow-support/
    github-cost-center-api.js
    parse-cost-center-request.js
    validate-cost-center-request.js
    reconcile-cost-center-changes.js
    resolve-cost-center-approver.js
    build-cost-center-artifact.js
  scripts/
    run-cost-center-validation.js
    run-cost-center-approval.js
    run-cost-center-execution.js
    emit-cost-center-summary.js

tests/
  contract/
    manage-cost-centers-parser-fixture.test.js
    manage-cost-centers-validation.test.js
  integration/
    manage-cost-centers-workflow.test.js
```

**Structure Decision**: Keep issue intake in `.github/ISSUE_TEMPLATE/manage-cost-centers.yml` and the GitHub-required entrypoint in `.github/workflows/manage-cost-centers.yml` as a thin orchestration shim. Place CSV parsing, validation, reconciliation, approver resolution, the cost-center REST client, and the audit-artifact builder under `src/workflow-support/`, the mutation policy guard under `src/actions/cost-center-policy/`, and the validation, approval, execution, and summary runners under `src/scripts/`. This feature ships its own parse, validate, reconcile, approver, artifact, and summary modules rather than extending the org/team operation dispatcher so the enterprise-billing concern stays isolated. Add parser and validation contract tests under `tests/contract/` and the end-to-end workflow test under `tests/integration/`. No exception to the constitution structure rules is required.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
