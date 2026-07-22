# Implementation Plan: Add Team Repo Access CSV Attachment Intake

**Branch**: `013-setup-feature-branch` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/013-add-team-repo-access-csv-attachment/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the existing add-team-repo-access IssueOps workflow so requesters can choose `manual` or `csv_attachment` intake, submit baseline request metadata first, and then provide exactly one requester-authored CSV attachment in a same-issue comment for high-volume repository grant requests. The implementation preserves baseline behavior and guarantees from features `005` and `009`, introduces a waiting-for-attachment lifecycle for attachment mode, preserves preserved CSV semantics after attachment download, and enforces terminal-state immutability so executed requests ignore later attachment comments and never reopen to `waiting_for_attachment`, `validation_failed`, or `awaiting_approval`.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` with Node.js scripts for parsing, validation, approval gate, and execution  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, existing add-team-repo-access workflow-support modules, and attachment discovery/download/hash helpers reused from attachment features  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged target-org reads and repository grant mutation; repository `github.token` for non-privileged workflow context operations  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/add-team-repo-access.yml`, `.github/workflows/add-team-repo-access.yml`, workflow env wiring for issue and comment context, operation-aware terminal labels, and JSON audit artifact schema  
**Testing**: `actionlint`, `node --test` contract tests, parser/validation fixtures, and integration tests for manual non-regression, waiting lifecycle, corrected attachment supersession, approval continuity, terminal ignore behavior, dry-run, and partial failures  
**Target Platform**: GitHub-hosted runners  
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: Structured step summaries, JSON audit artifacts, attachment provenance records, row-level CSV findings, and lifecycle outputs (waiting, awaiting approval, terminal)  
**Constraints**: Preserve baseline semantics from `005` and `009`, requester-only attachment acceptance, fail-closed candidate resolution, explicit approval-gate continuity, least privilege, dry-run non-mutation guarantees, bounded retries, and operation-aware terminal-state immutability  
**Scale/Scope**: Single-repository IssueOps enhancement for one organization/one team/one permission-level-per-request repository access grants with multi-repository CSV intake

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
specs/013-add-team-repo-access-csv-attachment/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── add-team-repo-access-csv-attachment-workflow.yaml
└── tasks.md
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
    parse-team-repo-access-request.*
    normalize-requested-repositories.*
    normalize-bulk-csv-requested-repositories.*
    validate-team-repo-access-request.*
    resolve-team-repo-approver.*
    resolve-csv-attachment-comment.*
    download-csv-attachment.*
    hash-attachment-content.*
    reconcile-team-repo-access.*
    build-audit-artifact.*
  scripts/
    restore-request-audit-artifact.*
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    add-team-repo-access-*.test.*
  fixtures/
    add-team-repo-access-*.json
    add-team-repo-access-*.md
  integration/
    add-team-repo-access-*.test.*
```

**Structure Decision**: Use constitution-aligned structure with no exceptions. Keep `.github/ISSUE_TEMPLATE/add-team-repo-access.yml` as request intake and `.github/workflows/add-team-repo-access.yml` as a thin orchestrator shim. Implement attachment candidate resolution, download, hash, validation lifecycle, terminal-state detection, and normalization reuse under `src/workflow-support/`, while keeping execution orchestration in `src/scripts/`. Add regression and attachment-specific tests under `tests/contract` and `tests/integration` without regressing baseline manual or preserved CSV semantics.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
