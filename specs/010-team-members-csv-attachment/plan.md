# Implementation Plan: Add Team Members CSV Attachment Intake

**Branch**: `010-team-members-csv-attachment` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-team-members-csv-attachment/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the existing add-team-members IssueOps workflow so requesters can choose
manual intake or a new `csv_attachment` intake mode, submit the issue, and then
provide exactly one CSV attachment in a requester-authored issue comment while
preserving the manual path, organization-owner approval gate,
reconciliation-first membership mutation, audit evidence, and row-level CSV
validation guarantees already defined by features `001` and `006`. The
implementation will keep `.github/workflows/add-team-members.yml` as the single
entrypoint, replace the textarea-based bulk CSV path in the issue form with an
explicit intake-mode selector, extend the parser and validation model with an
attachment-waiting state and attachment provenance, add a repo-local attachment
discovery and download helper under `src/workflow-support/`, and normalize the
accepted attachment content into the same downstream request and reconciliation
model used by manual requests.

## Technical Context

**Workflow Runtime**: GitHub Actions workflow shim on `ubuntu-latest` with `actions/setup-node@v6` and Node.js 24 for the existing add-team-members runner  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, existing Node-based workflow support modules under `src/workflow-support/`, and new repo-local helpers for attachment discovery, attachment download, and attachment provenance normalization  
**Authentication Model**: PAT-backed workflow token loaded from `ISSUEOPS_GITHUB_TOKEN` for issue and comment reads, attachment download, approval checks, team validation, user resolution, and team membership mutation, with repository `github.token` still sufficient for the initial event payload read  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/add-team-members.yml`, `.github/workflows/add-team-members.yml`, parser outputs passed through workflow environment variables, issue comment event payloads, audit artifact schema, and shared validation, attachment, and reconciliation helpers under `src/`  
**Testing**: `actionlint`, `node --test` parser fixture tests, contract tests, validator unit coverage for intake-mode rules, comment attachment discovery, attachment provenance, CSV row findings, and integration dry-run or replay tests for manual, waiting-for-attachment, and accepted-attachment request paths  
**Target Platform**: GitHub-hosted runners using repository or organization secrets for token injection  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: GitHub step summaries, machine-readable JSON audit artifacts, waiting-state summaries, attachment provenance fields, validation findings with row-level CSV detail, and requester-facing workflow summaries  
**Constraints**: preserve feature `001` manual-path behavior, supersede feature `006` textarea bulk input without losing its CSV semantics, require exactly one supported intake mode per request, require requester-authored same-issue attachment comments, accept one CSV attachment per active validation attempt, fail closed on ambiguous attachment discovery, preserve approval before mutation, preserve dry-run support, preserve idempotent reconciliation, preserve bounded retry behavior, and ignore later attachment comments after an executed terminal state  
**Scale/Scope**: Repository-wide enhancement to the existing add-team-members IssueOps flow for very large membership requests, designed so the attachment-based high-volume pattern can be reused by later IssueOps features without widening this feature beyond one team per request and one accepted attachment-driven desired-membership batch per request lifecycle

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
specs/010-team-members-csv-attachment/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── add-team-members-csv-attachment-workflow.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    add-team-members.yml
  workflows/
    add-team-members.yml

src/
  actions/
    team-membership-policy/
  workflow-support/
    normalize-requested-people.*
    parse-team-membership-request.*
    validate-team-membership-request.*
    reconcile-team-members.*
    approval-gate.*
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

tests/
  contract/
    add-team-members-parser-fixture.test.*
    add-team-members-approval-policy.test.*
    add-team-members-csv-attachment-parser-fixture.test.*
    add-team-members-csv-attachment-validation.test.*
  fixtures/
    add-team-members-issue.md
    add-team-members-csv-attachment-issue.md
    add-team-members-csv-attachment-comments.json
  integration/
    add-team-members-request.test.*
    add-team-members-approval.test.*
    add-team-members-csv-attachment-request.test.*
```

**Structure Decision**: Reuse the repository-standard IssueOps layout without
exception. Keep `.github/ISSUE_TEMPLATE/add-team-members.yml` as the single
intake surface, keep `.github/workflows/add-team-members.yml` as the thin
GitHub-required entrypoint shim, and place the substantive intake-mode,
attachment-discovery, attachment-download, validation, and request-model
extensions under `src/workflow-support/`. Existing approval, reconciliation,
execution, and summary scripts under `src/scripts/` remain the execution path
after attachment normalization. Testing stays repo-local under `tests/` with
explicit new coverage for manual non-regression, waiting-for-attachment
behavior, requester-only attachment acceptance, corrected second-comment flows,
and post-terminal-state ignore behavior.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
