# Implementation Plan: Remove Team Repository Access Workflow

**Branch**: `020-remove-team-repo-access` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-remove-team-repo-access/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Add an IssueOps workflow capability to remove one existing team from one or more repositories in a target organization while preserving governance, approval, parser-first validation, reconciliation-first execution, and audit semantics from repo-access baselines. Implementation preserves manual intake behavior and csv attachment lifecycle semantics, including waiting-for-attachment, requester-only candidate acceptance, deterministic supersession, and terminal-state immutability. Reconciliation executes removal only when explicit access exists and records no-op when already absent, with drift-aware reruns and bounded retry handling.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` with Node.js orchestration scripts  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/checkout@v4`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, shared workflow-support modules  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged reads/mutations; `github.token` for non-privileged workflow context operations  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/remove-team-repo-access.yml`, `.github/workflows/remove-team-repo-access.yml`, workflow env/output wiring, policy helpers  
**Testing**: `actionlint`, `node --test` contract tests, parser fixtures, integration tests for waiting/approval/removal/no-op/terminal behavior  
**Target Platform**: GitHub-hosted runners
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: Structured step summaries, JSON audit artifacts, attachment provenance, row-level findings, per-repository removal outcomes  
**Constraints**: Least privilege, explicit approval gates, fail-closed validation, bounded retries, idempotent reruns, terminal-state immutability  
**Scale/Scope**: One org + one team + one approver + one-or-more repositories per request batch for removal operations

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
specs/020-remove-team-repo-access/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── remove-team-repo-access-workflow.yaml
└── tasks.md
```

### Source Code (repository root)

```text
.github/
  ISSUE_TEMPLATE/
    remove-team-repo-access.yml
  workflows/
    remove-team-repo-access.yml

src/
  actions/
    team-repo-access-policy/
  workflow-support/
    parse-team-repo-access-removal-request.*
    resolve-csv-attachment-comment.*
    download-csv-attachment.*
    validate-team-repo-access-removal-request.*
    reconcile-team-repo-access-removal.*
    build-audit-artifact.*
  scripts/
    restore-request-audit-artifact.*
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    remove-team-repo-access-*.test.*
  fixtures/
    remove-team-repo-access-*.json
    remove-team-repo-access-*.md
  integration/
    remove-team-repo-access-*.test.*
```

**Structure Decision**: Use constitution-aligned layout without exceptions. Keep issue intake in `.github/ISSUE_TEMPLATE/remove-team-repo-access.yml` and keep `.github/workflows/remove-team-repo-access.yml` as a thin orchestration shim. Implement parsing, attachment lifecycle validation, reconciliation, and execution helpers under `src/workflow-support` and `src/scripts` by extending existing repo-access modules where feasible to preserve non-regression behavior.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
