# Implementation Plan: Add Bulk CSV Mode for Add Child Teams

**Branch**: `008-add-child-teams-bulk-csv-mode` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/008-add-child-teams-bulk-csv-mode/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the existing add-child-teams IssueOps workflow so requesters can paste
high-volume CSV input into an optional bulk CSV textarea while preserving the
current manual `requested_child_teams` path, the single shared designated
hierarchy approver model, reconciliation-first child-link execution, dry-run
behavior, and audit evidence defined by feature `004-add-child-teams`. The
implementation will extend the existing issue form, workflow shim, parser, and
validation modules; add a repo-local CSV normalization helper under
`src/workflow-support/`; and normalize both intake modes into the same
downstream request and reconciliation model.

## Technical Context

**Workflow Runtime**: GitHub Actions workflow shim on `ubuntu-latest` with `actions/setup-node@v6` and Node.js 24 for the existing add-child-teams runner  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, existing Node-based workflow support modules under `src/workflow-support/`, and a new repo-local CSV normalization helper  
**Authentication Model**: PAT-backed workflow token loaded from `ISSUEOPS_GITHUB_TOKEN` for issue reads, approval checks, organization validation, hierarchy-state reads, designated-approver verification, and child-team hierarchy mutation  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/add-child-teams.yml`, `.github/workflows/add-child-teams.yml`, parser outputs passed through workflow environment variables, audit artifact schema, and shared validation or reconciliation helpers under `src/`  
**Testing**: `actionlint`, `node --test` parser fixture tests, contract tests, validator coverage for intake-mode rules and CSV row findings, and integration dry-run or replay tests for manual and CSV request paths  
**Target Platform**: GitHub-hosted runners using repository or organization secrets for token injection
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries, machine-readable JSON audit artifacts, validation findings with row-level CSV detail, and requester-facing workflow summaries  
**Constraints**: preserve feature `004-add-child-teams` manual-path behavior, exactly one populated intake mode per request, one target organization and one parent team per request, one shared designated hierarchy approver per request, least privilege within PAT scope, approval before mutation, dry-run support, idempotent reconciliation, bounded retry behavior, no repo-hosted source of truth, and continued rejection of re-parenting or cycle-creating requests  
**Scale/Scope**: Repository-wide enhancement to the existing add-child-teams IssueOps flow for higher-volume hierarchy requests, designed so the bulk-input pattern can be reused by later IssueOps features without widening this feature beyond one organization, one parent team, and one shared hierarchy approver per request

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
specs/008-add-child-teams-bulk-csv-mode/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── add-child-teams-bulk-csv-workflow.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    add-child-teams.yml
  workflows/
    add-child-teams.yml

src/
  actions/
    team-hierarchy-policy/
  workflow-support/
    normalize-requested-child-teams.*
    normalize-bulk-csv-requested-child-teams.*
    parse-team-hierarchy-request.*
    validate-team-hierarchy-request.*
    reconcile-team-hierarchy.*
    resolve-team-hierarchy-approver.*
    github-team-api.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    add-child-teams-parser-fixture.test.*
    add-child-teams-approval-policy.test.*
    add-child-teams-bulk-csv-parser-fixture.test.*
    add-child-teams-bulk-csv-validation.test.*
  fixtures/
    add-child-teams-issue.md
    add-child-teams-bulk-csv-issue.md
  integration/
    add-child-teams-request.test.*
    add-child-teams-approval.test.*
    add-child-teams-bulk-csv-request.test.*
    add-child-teams-workflow.test.*
```

**Structure Decision**: Reuse the repository-standard IssueOps layout without
exception. Keep `.github/ISSUE_TEMPLATE/add-child-teams.yml` as the single
intake surface, keep `.github/workflows/add-child-teams.yml` as the thin
GitHub-required entrypoint shim, and place the substantive CSV normalization,
intake-mode validation, and request-model extensions under
`src/workflow-support/`. Existing approval, reconciliation, execution, and
summary scripts under `src/scripts/` remain the execution path after intake
normalization. Testing stays repo-local under `tests/` with explicit new
coverage for manual non-regression, CSV parser fixtures, row-level validation,
and integration reruns.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
