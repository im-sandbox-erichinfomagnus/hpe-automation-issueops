# Implementation Plan: Add Child Teams CSV Attachment Intake

**Branch**: `012-add-child-teams-csv` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-add-child-teams-csv-attachment/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.
Use the constitution section `Repository Structure Conventions` as the authoritative repository layout unless this plan records an explicitly approved exception.

## Summary

Enhance the existing add-child-teams IssueOps workflow so requesters can
choose `manual` or `csv_attachment` intake, submit the issue first, and then
provide exactly one requester-authored CSV attachment in a same-issue comment
for high-volume child-link requests. The implementation keeps the existing
approval and reconciliation semantics from features `004` and `008`, adds a
waiting-for-attachment lifecycle for attachment mode, preserves row-level CSV
normalization behavior after attachment download, and enforces terminal-state
immutability so requests already executed (including partially executed or
failed-after-approved-execution) ignore later attachment comments and never
reopen to `waiting_for_attachment` or `awaiting_approval`.

## Technical Context

**Workflow Runtime**: GitHub Actions thin workflow shim on `ubuntu-latest` using Node.js runtime for request parsing, validation, approval gate, and execution scripts  
**Primary Dependencies**: `issue-ops/parser@v5`, `actions/checkout@v6`, `actions/setup-node@v6`, `actions/upload-artifact@v7`, existing repository workflow-support modules for add-child-teams, plus attachment discovery and download helpers reused from attachment features  
**Authentication Model**: PAT-backed `ISSUEOPS_GITHUB_TOKEN` for privileged reads and hierarchy mutations; repository `github.token` for workflow event context and non-privileged operations  
**Configuration Surface**: `.github/ISSUE_TEMPLATE/add-child-teams.yml`, `.github/workflows/add-child-teams.yml`, workflow env wiring, issue comment event payloads, operation-aware terminal labels, and JSON audit artifact schema  
**Testing**: `actionlint`, `node --test` contract tests, parser fixtures, validation tests, and integration tests for manual non-regression, waiting-for-attachment lifecycle, corrected attachment flow, terminal-state ignore behavior, dry-run, and partial failures  
**Target Platform**: GitHub-hosted runners
**Project Type**: IssueOps automation repository with reusable workflows and issue templates  
**Observability**: Structured step summaries, JSON audit artifacts, attachment provenance records, per-row CSV findings, and lifecycle status outputs including waiting and terminal states  
**Constraints**: Preserve baseline behavior from features `004` and `008`, require requester-only attachment acceptance, fail closed on ambiguous or invalid attachment candidates, preserve single designated hierarchy approver model, enforce least privilege, preserve dry-run and idempotent reconciliation, and bound GitHub API retries  
**Scale/Scope**: Single-repository IssueOps enhancement for add-child-teams requests in one organization and one parent-team context per request; attachment intake changes only request ingestion, not privileged execution semantics

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
specs/012-add-child-teams-csv-attachment/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/
│   └── add-child-teams-csv-attachment-workflow.yaml
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
    parse-team-hierarchy-request.*
    normalize-requested-child-teams.*
    validate-team-hierarchy-request.*
    reconcile-team-hierarchy.*
    github-team-api.*
    download-csv-attachment.*
    resolve-csv-attachment-comment.*
    build-audit-artifact.*
  scripts/
    restore-request-audit-artifact.*
    run-request-validation.*
    run-approval-gate.*
    run-approved-execution.*
    emit-audit-summary.*

tests/
  contract/
    add-child-teams-parser-fixture.test.*
    add-child-teams-csv-attachment-parser-fixture.test.*
    add-child-teams-csv-attachment-validation.test.*
  fixtures/
    add-child-teams-issue.md
    add-child-teams-csv-attachment-issue.md
    add-child-teams-csv-attachment-comments.json
  integration/
    add-child-teams-request.test.*
    add-child-teams-csv-attachment-request.test.*
    add-child-teams-approval.test.*
```

**Structure Decision**: Use the constitution-aligned repository structure with
no exceptions. Keep `.github/ISSUE_TEMPLATE/add-child-teams.yml` as the
request intake surface and `.github/workflows/add-child-teams.yml` as the thin
entrypoint shim. Implement attachment candidate discovery, attachment download,
terminal-state detection, validation, and normalization extensions in
`src/workflow-support/`, while preserving existing approval and execution
scripts in `src/scripts/`. Add contract, fixture, and integration coverage
under `tests/` for manual non-regression, attachment waiting lifecycle,
corrected requester comment supersession, and terminal-state ignore behavior.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
