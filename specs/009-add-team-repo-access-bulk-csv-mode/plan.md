# Implementation Plan: Add Bulk CSV Mode for Team Repository Access

**Branch**: `009-add-team-repo-access-bulk-csv-mode` | **Date**: 2026-05-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-add-team-repo-access-bulk-csv-mode/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the existing add-team-repo-access IssueOps workflow so requesters can
paste high-volume CSV input into an optional bulk CSV textarea while
preserving the current manual `requested_repositories` path, the single shared
designated repository-access approver model, reconciliation-first repository
permission grants, dry-run behavior, and audit evidence defined by feature
`005-add-team-repo-access`. The implementation will extend the existing issue
form, workflow shim, parser, and validation modules; add a repo-local CSV
normalization helper under `src/workflow-support/`; and normalize both intake
modes into the same downstream repository-grant and reconciliation model.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Workflow Runtime**: GitHub Actions workflow shim on `ubuntu-latest` with `actions/setup-node@v6` and Node.js 24 for the existing add-team-repo-access runner  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, existing Node-based workflow support modules under `src/workflow-support/`, and a new repo-local CSV normalization helper for requested repositories  
**Authentication Model**: PAT-backed workflow token loaded from `ISSUEOPS_GITHUB_TOKEN` for issue reads, approval checks, organization validation, team and repository visibility checks, designated-approver verification, and repository team-permission mutation  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/add-team-repo-access.yml`, `.github/workflows/add-team-repo-access.yml`, parser outputs passed through workflow environment variables, audit artifact schema, and shared validation or reconciliation helpers under `src/`  
**Testing**: `actionlint`, `node --test` parser fixture tests, contract tests, validator coverage for intake-mode rules and CSV row findings, and integration dry-run or replay tests for manual and CSV request paths  
**Target Platform**: GitHub-hosted runners using repository or organization secrets for token injection
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries, machine-readable JSON audit artifacts, validation findings with row-level CSV detail, and requester-facing workflow summaries  
**Constraints**: preserve feature `005-add-team-repo-access` manual-path behavior, exactly one populated intake mode per request, one target organization and one target team per request, one shared designated repository-access approver per request, one requested permission level per request, least privilege within PAT scope, approval before mutation, dry-run support, idempotent reconciliation, bounded retry behavior, no repo-hosted source of truth, and continued rejection of weaker-permission upgrades, permission downgrades, removals, or broader repository-administration changes  
**Scale/Scope**: Repository-wide enhancement to the existing add-team-repo-access IssueOps flow for higher-volume repository-access requests, designed so the bulk-input pattern can be reused by later IssueOps features without widening this feature beyond one organization, one existing team, one shared repository permission level, and one shared designated approver per request

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
specs/009-add-team-repo-access-bulk-csv-mode/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── add-team-repo-access-bulk-csv-workflow.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    add-team-repo-access.yml
  workflows/
    add-team-repo-access.yml

src/
  actions/
    team-repo-access-policy/
  workflow-support/
    normalize-requested-repositories.*
    normalize-bulk-csv-requested-repositories.*
    parse-team-repo-access-request.*
    validate-team-repo-access-request.*
    reconcile-team-repo-access.*
    resolve-team-repo-access-approver.*
    github-team-repo-api.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    add-team-repo-access-parser-fixture.test.*
    add-team-repo-access-approval-policy.test.*
    add-team-repo-access-bulk-csv-parser-fixture.test.*
    add-team-repo-access-bulk-csv-validation.test.*
  fixtures/
    add-team-repo-access-issue.md
    add-team-repo-access-bulk-csv-issue.md
  integration/
    add-team-repo-access-request.test.*
    add-team-repo-access-approval.test.*
    add-team-repo-access-bulk-csv-request.test.*
    add-team-repo-access-workflow.test.*
```

**Structure Decision**: Reuse the repository-standard IssueOps layout without
exception. Keep `.github/ISSUE_TEMPLATE/add-team-repo-access.yml` as the single
intake surface, keep `.github/workflows/add-team-repo-access.yml` as the thin
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
