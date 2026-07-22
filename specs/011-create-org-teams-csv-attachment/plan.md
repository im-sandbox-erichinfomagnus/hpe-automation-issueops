# Implementation Plan: Create Organization Teams CSV Attachment Intake

**Branch**: `011-create-org-teams-csv-attachment` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-create-org-teams-csv-attachment/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the existing create-org-teams IssueOps workflow so requesters can choose
manual intake or a new `csv_attachment` intake mode, submit the issue, and then
provide exactly one CSV attachment in a requester-authored issue comment while
preserving the manual path from feature `003`, the CSV schema and row-level
validation guarantees from feature `007`, the single shared intended-owner
approval gate, reconciliation-first create-only-missing behavior, and auditable
execution outcomes. The implementation will keep
`.github/workflows/create-org-teams.yml` as the single entrypoint, replace the
textarea-based bulk CSV path in the issue form with an explicit intake-mode
selector, extend the parser and validation model with an attachment-waiting
state and attachment provenance, add repo-local attachment discovery and
download helpers under `src/workflow-support/`, and normalize the accepted
attachment content into the same downstream request and reconciliation model
used by manual and prior bulk CSV requests.

## Technical Context

**Workflow Runtime**: GitHub Actions workflow shim on `ubuntu-latest` with `actions/setup-node@v6` and Node.js 24 for the existing create-org-teams runner  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, existing Node-based workflow support modules under `src/workflow-support/`, and new repo-local helpers for attachment discovery, attachment download, and attachment provenance normalization  
**Authentication Model**: PAT-backed workflow token loaded from `ISSUEOPS_GITHUB_TOKEN` for issue and comment reads, attachment download, intended-owner verification, organization validation, current-team inspection, and team creation, with repository `github.token` still sufficient for initial event payload reads  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/create-org-teams.yml`, `.github/workflows/create-org-teams.yml`, parser outputs passed through workflow environment variables, issue comment event payloads, audit artifact schema, and shared validation, attachment, and reconciliation helpers under `src/`  
**Testing**: `actionlint`, `node --test` parser fixture tests, contract tests, validator coverage for intake-mode rules, attachment provenance, CSV row findings, and integration dry-run or replay tests for manual, waiting-for-attachment, and accepted-attachment request paths  
**Target Platform**: GitHub-hosted runners using repository or organization secrets for token injection
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries, machine-readable JSON audit artifacts, waiting-state summaries, attachment provenance fields, validation findings with row-level CSV detail, and requester-facing workflow summaries  
**Constraints**: preserve feature `003` manual-path behavior, preserve feature `007` CSV schema and row-level semantics, supersede textarea bulk CSV input for new requests, require exactly one supported intake mode per request, require requester-authored same-issue attachment comments, accept one CSV attachment per active validation attempt, fail closed on ambiguous attachment discovery, preserve approval before mutation, preserve dry-run support, preserve idempotent reconciliation, preserve bounded retry behavior, and ignore later attachment comments after an executed terminal state  
**Scale/Scope**: Repository-wide enhancement to the existing create-org-teams IssueOps flow for high-volume team-creation requests, designed so the attachment-based high-volume pattern can be reused by later IssueOps features without widening this feature beyond one organization and one shared intended owner per request lifecycle

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
specs/011-create-org-teams-csv-attachment/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── create-org-teams-csv-attachment-workflow.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    create-org-teams.yml
  workflows/
    create-org-teams.yml

src/
  actions/
    team-creation-policy/
  workflow-support/
    normalize-requested-teams.*
    parse-team-creation-request.*
    validate-team-creation-request.*
    reconcile-team-creation.*
    build-audit-artifact.*
    github-team-api.*
    resolve-csv-attachment-comment.*
    download-csv-attachment.*
    hash-attachment-content.*
  scripts/
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*
    restore-request-audit-artifact.*

tests/
  contract/
    create-org-teams-parser-fixture.test.*
    create-org-teams-csv-attachment-parser-fixture.test.*
    create-org-teams-csv-attachment-validation.test.*
  fixtures/
    create-org-teams-issue.md
    create-org-teams-csv-attachment-issue.md
    create-org-teams-csv-attachment-comments.json
  integration/
    create-org-teams-request.test.*
    create-org-teams-approval.test.*
    create-org-teams-csv-attachment-request.test.*
    create-org-teams-workflow.test.*
```

**Structure Decision**: Reuse the repository-standard IssueOps layout without
exception. Keep `.github/ISSUE_TEMPLATE/create-org-teams.yml` as the single
intake surface, keep `.github/workflows/create-org-teams.yml` as the thin
GitHub-required entrypoint shim, and place the substantive intake-mode,
attachment-discovery, attachment-download, validation, and request-model
extensions under `src/workflow-support/`. Existing approval, reconciliation,
execution, audit-artifact, and summary scripts under `src/scripts/` remain the
execution path after attachment normalization. Testing stays repo-local under
`tests/` with explicit new coverage for manual non-regression,
waiting-for-attachment behavior, requester-only attachment acceptance,
corrected later-comment flows, and post-terminal-state ignore behavior.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
